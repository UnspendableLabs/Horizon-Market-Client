import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import {
  CREATION_MEDIA_TYPES,
  MAX_CREATION_ATTRIBUTES,
  MAX_CREATION_DESCRIPTION_LENGTH,
  MAX_INSCRIPTION_BYTES,
  Modal,
  WorkflowProgress,
  formatXcp,
  useCreateToken,
  useHorizonMarket,
  type CreatableType,
  type CreationRetryStore,
  type PersistedCreationRetry,
  type UseCreateTokenResult,
} from "@unspendablelabs/horizon-market-client/react";
import { ConnectPrompt } from "../components/ConnectPrompt.js";
import { Header } from "../components/Header.js";
import { StandaloneTabBar } from "../components/TabBar.js";
import { ToggleButton, toggleGroupStyle } from "../components/ToggleButton.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import {
  trackCreateCompleted,
  trackCreateFailed,
  trackCreateQuoted,
} from "../lib/analytics/events.js";

const PROTOCOLS: { value: CreatableType; label: string }[] = [
  { value: "counterparty", label: "Counterparty" },
  { value: "ordinals", label: "Ordinals" },
];

const MEDIA_TYPES: readonly string[] = CREATION_MEDIA_TYPES;

/**
 * Content type per file extension, for the picker results that report none.
 *
 * Deliberately image-only and deliberately short of {@link CREATION_MEDIA_TYPES}:
 * an extension this cannot name — `.heic` above all — is one to refuse rather
 * than guess at.
 */
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function mediaTypeFromUri(uri: string): string | undefined {
  const extension = uri.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase();
  return extension ? EXTENSION_MEDIA_TYPES[extension] : undefined;
}

/** A plausible extension for an accepted content type — the server re-sniffs it. */
function extensionForMediaType(type: string): string {
  for (const [extension, value] of Object.entries(EXTENSION_MEDIA_TYPES)) {
    if (value === type) return extension;
  }
  // "image/svg+xml" → "svg", "video/mp4" → "mp4".
  return type.split("/")[1]?.split("+")[0] ?? "bin";
}

/**
 * A recovery outlives the process, in AsyncStorage.
 *
 * The body held after a broadcast-but-unconfirmed creation is the only thing
 * that can finish it — re-composing broadcasts a second transaction, and for an
 * ordinal strands the first commit's funds forever. React state does not survive
 * a swipe out of the app switcher, so the hook's refusal to let the user leave is
 * only worth as much as this is.
 *
 * Keyed by network and funding address: a recovery belongs to the wallet that
 * signed it, and restoring one under another wallet is worse than losing it.
 */
function makeRetryStore(key: string): CreationRetryStore {
  return {
    async load() {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as PersistedCreationRetry;
      } catch {
        // Unreadable is the same as absent, and leaving it would fail forever.
        await AsyncStorage.removeItem(key);
        return null;
      }
    },
    save: (retry) => AsyncStorage.setItem(key, JSON.stringify(retry)),
    clear: () => AsyncStorage.removeItem(key),
  };
}

/**
 * Create screen — reached from the hamburger in the {@link Header}, alongside
 * the Token Explorer: the explorer lists what exists, this adds to it.
 *
 * One form for both protocols. Counterparty is the default and the only one
 * with a supply to speak of; picking Ordinals pins quantity / divisible /
 * locked at the only values an inscription can have, rather than hiding fields
 * and leaving the reader wondering what happened to them.
 *
 * Both the quote and the media upload are session-gated, so — exactly like the
 * Profile screen — this needs a connected wallet *and* the Horizon Market
 * session the provider mints from it.
 */
export default function CreateScreen() {
  const { addresses } = useHorizonMarket();

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Create</Text>

        {addresses ? (
          <CreateEditor />
        ) : (
          <ConnectPrompt message="Connect your wallet to create a token." />
        )}
      </ScrollView>
      <StandaloneTabBar />
    </View>
  );
}

function CreateEditor() {
  const { isAuthenticated, signInError, addresses, network } =
    useHorizonMarket();

  // Read by the analytics callbacks below, which are handed to the hook that
  // produces `create` — reaching for that binding directly would be a reference
  // into a `const` the same statement is still initializing.
  const protocolRef = useRef<CreatableType>("counterparty");

  const retryStore = useMemo(
    () => makeRetryStore(`horizon.create-retry.${network}.${addresses?.p2wpkh}`),
    [network, addresses?.p2wpkh],
  );

  const create = useCreateToken({
    retryStore,
    onSuccess: (result) =>
      trackCreateCompleted({
        protocol: result.type,
        identifier: result.identifier,
      }),
    onError: (error) =>
      trackCreateFailed({ protocol: protocolRef.current, error }),
  });
  protocolRef.current = create.formValues.type;

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  // Fabric drops keystrokes on a controlled numeric TextInput, so quantity is
  // uncontrolled and remounted whenever the value must change from the outside
  // — which is what picking Ordinals does.
  const [quantityNonce, setQuantityNonce] = useState(0);

  const {
    formValues,
    setFormValues,
    fieldErrors,
    advancedReadOnly,
    canQuote,
    quoting,
    requestQuote,
    quote,
    error,
    xcpFee,
  } = create;

  const pickImage = async () => {
    setPickerError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPickerError("Photo access is needed to choose an image.");
      return;
    }
    // No crop: token art is not an avatar, and the server stores what it is given.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    // iOS hands back HEIC, which the API refuses — catching it here saves a full
    // upload round-trip to learn that. The picker does not always report a
    // mimeType, and defaulting one to JPEG would wave that exact HEIC through
    // the check meant to catch it, so fall back to the extension and refuse
    // what neither can name.
    const type = asset.mimeType ?? mediaTypeFromUri(asset.uri);
    if (!type || !MEDIA_TYPES.includes(type)) {
      setPickerError(
        `${type ?? "That file"} isn't supported yet — pick a JPEG, PNG, GIF or WebP.`,
      );
      return;
    }

    // The 350 kB ceiling is enforced on the bytes the server fetches back at
    // quote time, so an oversized file uploads happily and fails later.
    setSizeWarning(
      asset.fileSize && asset.fileSize > MAX_INSCRIPTION_BYTES
        ? `This file is ${Math.round(asset.fileSize / 1024)} kB. Inscriptions are limited to ${Math.round(MAX_INSCRIPTION_BYTES / 1024)} kB — fine for Counterparty, too large for Ordinals.`
        : null,
    );

    await create.uploadImage(
      {
        uri: asset.uri,
        // Android reports no filename; the extension only has to match the type.
        name: asset.fileName ?? `token.${extensionForMediaType(type)}`,
        type,
      },
      asset.uri,
    );
  };

  const selectProtocol = (value: CreatableType) => {
    setFormValues({ type: value });
    // The hook pins the three advanced fields for an ordinal; the uncontrolled
    // quantity input has to be told.
    setQuantityNonce((n) => n + 1);
  };

  // A quote is where the cost first becomes real, so it is its own funnel step
  // — the gap between this and a completion is what the fee display answers for.
  useEffect(() => {
    if (!quote) return;
    trackCreateQuoted({
      protocol: quote.type,
      totalCostSats: quote.totalCostSats,
    });
  }, [quote]);

  if (!isAuthenticated) {
    return (
      <View style={styles.notice}>
        {signInError ? (
          <>
            <Text style={styles.noticeTitle}>Sign-in failed</Text>
            <Text style={styles.noticeText}>{signInError}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.noticeText}>
              Signing in to Horizon Market with your wallet…
            </Text>
          </>
        )}
      </View>
    );
  }

  const sizeWarningApplies =
    sizeWarning !== null && formValues.type === "ordinals";

  return (
    <View style={styles.sections}>
      {/* Artwork */}
      <View style={styles.imageBlock}>
        <Pressable
          onPress={() => void pickImage()}
          disabled={create.uploadingImage}
          style={styles.imageFrame}
          accessibilityRole="button"
          accessibilityLabel="Choose the token's image"
        >
          {formValues.imagePreviewUri ? (
            <Image
              source={{ uri: formValues.imagePreviewUri }}
              style={styles.imagePreview}
            />
          ) : create.uploadingImage ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.imagePlaceholder}>+</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => void pickImage()}
          disabled={create.uploadingImage}
          style={[
            styles.secondaryButton,
            create.uploadingImage && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>
            {create.uploadingImage
              ? "Uploading…"
              : formValues.image
                ? "Change image"
                : "Add an image"}
          </Text>
        </Pressable>
        {formValues.image && !create.uploadingImage && (
          <Text style={styles.fieldHint} numberOfLines={1}>
            Pinned to IPFS
          </Text>
        )}
        {(create.imageError || pickerError) && (
          <Text style={styles.errorText}>
            {create.imageError ?? pickerError}
          </Text>
        )}
        {sizeWarningApplies && (
          <Text style={styles.warningText}>{sizeWarning}</Text>
        )}
      </View>

      {/* Identity */}
      <View style={styles.section}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <View style={styles.nameRow}>
            <TextInput
              value={formValues.name}
              onChangeText={(name) => setFormValues({ name })}
              placeholder={
                formValues.type === "counterparty" ? "MYASSET" : "My inscription"
              }
              placeholderTextColor={colors.muted}
              autoCapitalize={
                formValues.type === "counterparty" ? "characters" : "sentences"
              }
              autoCorrect={false}
              style={[styles.input, styles.nameInput]}
            />
            {/* A numeric A… name is the one Counterparty registers for free, so
                this is the difference between creating now and topping up XCP
                first. Ordinals has no asset names, and no generator. */}
            {create.canGenerateName && (
              <Pressable
                onPress={create.generateName}
                style={styles.generateButton}
                accessibilityRole="button"
                accessibilityLabel="Generate a free numeric asset name"
              >
                <RefreshIcon color={colors.primary} />
                <Text style={styles.generateText}>Generate</Text>
              </Pressable>
            )}
          </View>
          <Text
            style={[styles.fieldHint, fieldErrors.name && styles.fieldHintError]}
          >
            {fieldErrors.name && formValues.name.length > 0
              ? fieldErrors.name
              : formValues.type === "counterparty"
                ? "Generate a free A… name, or pay to pick your own: 4–12 uppercase letters (MYASSET), or PARENT.child."
                : "Whatever you want the inscription to be called."}
          </Text>
          {xcpFee.notice && (
            <Text
              style={[
                styles.fieldHint,
                xcpFee.sufficient === false && styles.fieldHintError,
              ]}
            >
              {xcpFee.sufficient === false && xcpFee.balanceXcp !== null
                ? `${xcpFee.notice} You hold ${formatXcp(xcpFee.balanceXcp)} XCP — pick a numeric A… name, or top up.`
                : xcpFee.notice}
            </Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            value={formValues.description}
            onChangeText={(description) => setFormValues({ description })}
            placeholder="What is it?"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={MAX_CREATION_DESCRIPTION_LENGTH}
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.fieldHint}>
            {formValues.description.length}/{MAX_CREATION_DESCRIPTION_LENGTH}
          </Text>
        </View>
      </View>

      {/* Fee rate — on the form, not in the confirm sheet: every quote is a real
          composition (it pins to IPFS), so the rate has to be settled before we
          ask for one. */}
      <View style={styles.section}>
        <Text style={styles.fieldLabel}>Fee rate</Text>
        <View style={styles.toggle}>
          {create.feeOptions.map((option) => (
            <ToggleButton
              key={option}
              label={`${create.feeLabels[option]} · ${create.rateFor(option) ?? "…"}`}
              active={create.feeOption === option}
              onPress={() => create.setFeeOption(option)}
            />
          ))}
        </View>
        <Text style={styles.fieldHint}>
          {formValues.type === "ordinals"
            ? "sat/vB. An inscription's reveal is signed once and cannot be sped up later."
            : "sat/vB."}
        </Text>
      </View>

      {/* Advanced */}
      <View style={styles.section}>
        <Pressable
          onPress={() => setAdvancedOpen((open) => !open)}
          style={styles.advancedHeader}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
        >
          <ChevronIcon color={colors.mutedStrong} open={advancedOpen} />
          <Text style={styles.advancedTitle}>Advanced</Text>
        </Pressable>

        {advancedOpen && (
          <View style={styles.advancedBody}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Protocol</Text>
              <View style={styles.toggle}>
                {PROTOCOLS.map((protocol) => (
                  <ToggleButton
                    key={protocol.value}
                    label={protocol.label}
                    active={formValues.type === protocol.value}
                    onPress={() => selectProtocol(protocol.value)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Quantity</Text>
              <TextInput
                key={`quantity-${quantityNonce}`}
                defaultValue={formValues.quantity}
                onChangeText={(quantity) => setFormValues({ quantity })}
                editable={!advancedReadOnly}
                keyboardType="numeric"
                placeholder="1"
                placeholderTextColor={colors.muted}
                style={[styles.input, advancedReadOnly && styles.inputReadOnly]}
              />
              {fieldErrors.quantity && (
                <Text style={[styles.fieldHint, styles.fieldHintError]}>
                  {fieldErrors.quantity}
                </Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchTitle}>Divisible</Text>
                  <Text style={styles.switchSub}>
                    Can be held and traded in fractions, to 8 decimal places.
                  </Text>
                </View>
                <Switch
                  value={formValues.divisible}
                  onValueChange={(divisible) => setFormValues({ divisible })}
                  disabled={advancedReadOnly}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.foreground}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchTitle}>Locked</Text>
                  <Text style={styles.switchSub}>
                    The supply is final — no further issuance is possible.
                  </Text>
                </View>
                <Switch
                  value={formValues.lock}
                  onValueChange={(lock) => setFormValues({ lock })}
                  disabled={advancedReadOnly}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.foreground}
                />
              </View>
            </View>
            {advancedReadOnly && (
              <Text style={styles.fieldHint}>
                An ordinal is always one indivisible, locked inscription.
              </Text>
            )}

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Attributes</Text>
              {formValues.attributes.map((attribute) => (
                <View key={attribute.id} style={styles.attributeRow}>
                  <TextInput
                    value={attribute.key}
                    onChangeText={(key) =>
                      create.updateAttribute(attribute.id, { key })
                    }
                    placeholder="Trait"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    style={[styles.input, styles.attributeInput]}
                  />
                  <TextInput
                    value={attribute.value}
                    onChangeText={(value) =>
                      create.updateAttribute(attribute.id, { value })
                    }
                    placeholder="Value"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.attributeInput]}
                  />
                  <Pressable
                    onPress={() => create.removeAttribute(attribute.id)}
                    style={styles.attributeRemove}
                    hitSlop={spacing.sm}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove attribute ${attribute.key || "row"}`}
                  >
                    <Text style={styles.attributeRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={create.addAttribute}
                disabled={!create.canAddAttribute}
                style={[
                  styles.addAttribute,
                  !create.canAddAttribute && styles.buttonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add an attribute"
              >
                <Text style={styles.addAttributeText}>+</Text>
                <Text style={styles.secondaryButtonText}>Add attribute</Text>
              </Pressable>
              <Text
                style={[
                  styles.fieldHint,
                  fieldErrors.attributes && styles.fieldHintError,
                ]}
              >
                {fieldErrors.attributes ??
                  `Free-form metadata stored with the token. Up to ${MAX_CREATION_ATTRIBUTES}.`}
              </Text>
            </View>
          </View>
        )}
      </View>

      <Pressable
        onPress={() => void requestQuote()}
        disabled={!canQuote || quoting}
        style={[
          styles.primaryButton,
          (!canQuote || quoting) && styles.buttonDisabled,
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryButtonText}>
          {quoting ? "Getting fees…" : "Create"}
        </Text>
      </Pressable>
      {/* A quote that failed leaves the form untouched, so the message belongs
          here rather than in a sheet that never opened. */}
      {create.step === "form" && error && (
        <Text style={styles.errorText}>{error.message}</Text>
      )}

      <CreateSheet create={create} quotedIdentifier={quote?.identifier} />
    </View>
  );
}

/** Confirm → progress → result, in the SDK's modal, exactly as sell and buy do. */
function CreateSheet({
  create,
  quotedIdentifier,
}: {
  create: UseCreateTokenResult;
  quotedIdentifier: string | undefined;
}) {
  const { step, status, isSubmitting } = create;

  // The transaction may be on-chain and only its replay can finish the job, so
  // this failure has no way out but forward: leaving would drop the body Retry
  // re-sends, and the next Create would broadcast a second transaction. The
  // hook refuses `goBack()` here too — this is the affordance side of it.
  const awaitingReplay = create.awaitingReplay;

  const title =
    step === "confirm"
      ? "Confirm"
      : step === "progress"
        ? "Creating…"
        : status === "error"
          ? // "Failed" would be a lie once the transaction is on-chain: what is
            // left is the reveal that completes it.
            awaitingReplay
            ? "One step left"
            : "Creation failed"
          : "Token created";

  const close = () => {
    // Never mid-broadcast: the transaction is out of the user's hands by then.
    if (isSubmitting || awaitingReplay) return;
    if (step === "confirm" || (step === "result" && status === "error")) {
      create.goBack();
    } else {
      create.reset();
    }
  };

  return (
    <Modal
      open={step !== "form"}
      onClose={close}
      title={title}
      // `isSubmitting` too, not just the replay: mid-broadcast `close()` refuses
      // as well, and a ✕ wired to a handler that does nothing reads as a broken
      // app rather than a deliberate lock — which is what this prop is for.
      dismissible={!awaitingReplay && !isSubmitting}
    >
      {step === "confirm" ? (
        <CreateReview create={create} quotedIdentifier={quotedIdentifier} />
      ) : (
        <View style={styles.sheet}>
          <WorkflowProgress
            steps={create.steps}
            totalSteps={create.totalSteps}
            status={status}
            successMessage={
              create.result
                ? `${create.result.identifier ?? "Your token"} is on its way.`
                : undefined
            }
            errorMessage={create.error?.message}
          />
          {awaitingReplay && (
            <Text style={styles.fieldHint}>
              {create.replayRejected
                ? "The server is refusing this transaction, which usually means it is already confirmed. Save it below before giving up — it is the only copy."
                : "The transaction is already on-chain. Retry re-sends the same one — nothing is signed or paid again, and it is the only way to finish: starting over would broadcast a second transaction."}
            </Text>
          )}
          {step === "result" && (
            <View style={styles.sheetActions}>
              {status === "error" ? (
                <>
                  <Pressable
                    onPress={create.retry}
                    style={[styles.primaryButton, styles.flex1]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryButtonText}>Retry</Text>
                  </Pressable>
                  {/* No Back once the transaction is on-chain: see above. */}
                  {!awaitingReplay && (
                    <Pressable
                      onPress={create.goBack}
                      style={styles.textButton}
                      accessibilityRole="button"
                    >
                      <Text style={styles.textButtonText}>Back</Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <Pressable
                  onPress={create.reset}
                  style={[styles.primaryButton, styles.flex1]}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>Done</Text>
                </Pressable>
              )}
            </View>
          )}
          {/* Only once a replay has been tried and failed. Until then Retry is
              simply the right answer, and this is irreversible: it drops the one
              body that can finish the creation. So the copy comes first. */}
          {create.canAbandonReplay && <GiveUp create={create} />}
        </View>
      )}
    </Modal>
  );
}

/**
 * The last resort for a replay the server will not accept: save the signed
 * transaction, then walk away.
 *
 * The alternative is not "stay safe" — it is the user force-quitting the app,
 * which drops exactly the same body without saying so, and without offering the
 * copy that could still have finished the job by hand.
 */
function GiveUp({ create }: { create: UseCreateTokenResult }) {
  const [copied, setCopied] = useState(false);

  // Plainly, not through `useSecretClipboard`: that one wipes after a minute,
  // which is right for a recovery phrase and exactly wrong here. This is not a
  // secret — anyone holding it can only broadcast a transaction the user already
  // signed and wants broadcast — and it is being copied precisely so it can be
  // kept.
  const copy = async () => {
    if (!create.pendingSubmitJson) return;
    await Clipboard.setStringAsync(create.pendingSubmitJson);
    setCopied(true);
  };

  return (
    <View style={styles.giveUp}>
      <View style={styles.divider} />
      <Pressable
        onPress={() => void copy()}
        style={styles.secondaryButton}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryButtonText}>
          {copied ? "Copied — keep it somewhere safe" : "Copy the transaction"}
        </Text>
      </Pressable>
      <Pressable
        onPress={create.abandonReplay}
        disabled={!copied}
        style={[styles.textButton, !copied && styles.buttonDisabled]}
        accessibilityRole="button"
      >
        <Text style={styles.textButtonText}>
          {copied ? "Give up and start over" : "Copy it first"}
        </Text>
      </Pressable>
    </View>
  );
}

function CreateReview({
  create,
  quotedIdentifier,
}: {
  create: UseCreateTokenResult;
  quotedIdentifier: string | undefined;
}) {
  const { formValues, costLines, xcpFee, isSubmitting } = create;
  const protocol =
    PROTOCOLS.find((p) => p.value === formValues.type)?.label ?? formValues.type;

  return (
    <View style={styles.sheet}>
      <View style={styles.reviewHeader}>
        {formValues.imagePreviewUri && (
          <Image
            source={{ uri: formValues.imagePreviewUri }}
            style={styles.reviewThumb}
          />
        )}
        <View style={styles.reviewHeaderText}>
          <Text style={styles.reviewName} numberOfLines={1}>
            {quotedIdentifier ?? formValues.name}
          </Text>
          <Text style={styles.reviewSub}>{protocol}</Text>
        </View>
      </View>

      <View style={styles.card}>
        {costLines.map((line, index) => (
          <View key={line.key}>
            {index > 0 && <View style={styles.divider} />}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{line.label}</Text>
              <View style={styles.rowValues}>
                <Text
                  style={[styles.rowValue, line.emphasis && styles.rowValueTotal]}
                >
                  {line.satsDisplay} SATS
                </Text>
                {line.usd && <Text style={styles.rowUsd}>{line.usd}</Text>}
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* The quote's total is BTC only; the name fee is charged in XCP. */}
      {xcpFee.notice && <Text style={styles.fieldHint}>{xcpFee.notice}</Text>}

      <View style={styles.sheetActions}>
        <Pressable
          onPress={() => void create.confirmAndCreate()}
          disabled={isSubmitting}
          style={[
            styles.primaryButton,
            styles.flex1,
            isSubmitting && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Confirm &amp; sign</Text>
        </Pressable>
        <Pressable
          onPress={create.goBack}
          disabled={isSubmitting}
          style={styles.textButton}
          accessibilityRole="button"
        >
          <Text style={styles.textButtonText}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** lucide `refresh-cw` — draw another free name. */
function RefreshIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** lucide `chevron-right`, rotated down when the section is open. */
function ChevronIcon({ color, open }: { color: string; open: boolean }) {
  return (
    <Svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
    >
      <Path
        d="m9 18 6-6-6-6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },

  sections: { gap: spacing.lg },
  section: { gap: spacing.sm },

  imageBlock: { alignItems: "center", gap: spacing.sm },
  imageFrame: {
    width: 140,
    height: 140,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  imagePreview: { width: "100%", height: "100%" },
  imagePlaceholder: {
    fontSize: 40,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
  },

  field: { gap: spacing.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  nameInput: { flex: 1 },
  generateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  generateText: {
    fontSize: 13,
    color: colors.primary,
    fontFamily: fonts.sansSemiBold,
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.mutedStrong,
    fontFamily: fonts.sansSemiBold,
  },
  fieldHint: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 17,
  },
  fieldHintError: { color: colors.error },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 15,
    fontFamily: fonts.sans,
  },
  inputReadOnly: { color: colors.mutedStrong, opacity: 0.7 },
  textarea: { minHeight: 96, textAlignVertical: "top" },

  toggle: toggleGroupStyle,

  advancedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  advancedTitle: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  advancedBody: { gap: spacing.md, paddingTop: spacing.xs },

  attributeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  attributeInput: { flex: 1 },
  attributeRemove: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  attributeRemoveText: {
    fontSize: 20,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
  },
  addAttribute: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  addAttributeText: {
    fontSize: 16,
    color: colors.primary,
    fontFamily: fonts.sansBold,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: colors.border },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },
  rowValues: { alignItems: "flex-end" },
  rowValue: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  rowValueTotal: { fontSize: 17, fontFamily: fonts.sansBold },
  rowUsd: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  switchText: { flex: 1, gap: 2 },
  switchTitle: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  switchSub: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 17,
  },

  sheet: { gap: spacing.md },
  sheetActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  flex1: { flex: 1 },
  giveUp: { gap: spacing.sm, alignItems: "center" },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  reviewThumb: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHover,
  },
  reviewHeaderText: { flex: 1, gap: 2 },
  reviewName: {
    fontSize: 16,
    color: colors.foreground,
    fontFamily: fonts.sansBold,
  },
  reviewSub: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
  },

  primaryButton: {
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    fontSize: 15,
    color: colors.primaryForeground,
    fontFamily: fonts.sansBold,
  },
  secondaryButton: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  textButton: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  textButtonText: {
    fontSize: 14,
    color: colors.mutedStrong,
    fontFamily: fonts.sansSemiBold,
  },
  buttonDisabled: { opacity: 0.5 },

  notice: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  noticeTitle: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  noticeText: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sans,
    textAlign: "center",
    lineHeight: 19,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },
  warningText: {
    fontSize: 12,
    color: colors.warning,
    fontFamily: fonts.sans,
    lineHeight: 17,
    textAlign: "center",
  },
});
