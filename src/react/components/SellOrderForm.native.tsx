import { useMemo, useState, type ReactNode } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import { useTheme } from "../hooks/useTheme.js";
import {
  assetBalanceLabel,
  assetImageUrl,
  assetKey,
  describeAsset,
  formatRelativeTime,
  sellingDisplay,
} from "../internal/format.js";
import { AssetAvatar } from "../internal/icons.native.js";
import { ResultActions } from "../internal/ResultActions.native.js";
import { SellReview } from "../internal/SellReview.native.js";
import { useCommonSheet } from "../internal/styles.native.js";
import { useSellOrderFormController } from "../internal/useSellOrderFormController.js";
import { useSellReview } from "../internal/useSellReview.js";
import type { ResolvedTheme } from "../theme.js";
import { Modal } from "./Modal.native.js";
import {
  WorkflowProgress,
  type WorkflowProgressStyles,
} from "./WorkflowProgress.native.js";

export interface SellOrderFormStyles {
  root?: StyleProp<ViewStyle>;
  label?: StyleProp<TextStyle>;
  input?: StyleProp<TextStyle>;
  dropdownText?: StyleProp<TextStyle>;
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
  buttonSecondary?: StyleProp<ViewStyle>;
  buttonSecondaryText?: StyleProp<TextStyle>;
  progress?: WorkflowProgressStyles;
  error?: StyleProp<TextStyle>;
}

export interface SellOrderFormProps {
  defaultSatsPerVbyte?: number;
  /** Pre-select an asset to list (e.g. launched from a wallet balance). */
  initialAsset?: AssetOption | null;
  /**
   * Heading shown on both steps — above the asset list (step 1) and in the detail
   * header (step 2), opposite the back button. A string is styled as a title; any
   * other node renders as-is (pass a styled `<Text>` to match the app's other
   * screen titles).
   */
  title?: ReactNode;
  /**
   * How the review/confirm phase is presented:
   * - `"modal"` (default): the review pops a centered {@link Modal} over the
   *   form — the two-screen mobile flow used by the Sell tab (mirrors the buy
   *   confirmation modal).
   * - `"inline"`: the review replaces the form content in place — use when the
   *   form is already hosted inside a modal (e.g. the wallet's Sell action), so
   *   the confirmation doesn't stack a second modal.
   */
  reviewPresentation?: "modal" | "inline";
  onSuccess?: (swap: AtomicSwap, created: boolean) => void;
  onError?: (error: Error) => void;
  /**
   * Back/cancel handler for the detail-step back button when the form was
   * launched for a specific `initialAsset` — returns to wherever it opened from
   * (e.g. the wallet). Also the fallback dismiss for the result screen's "Close"
   * button when {@link onDone} is not given.
   */
  onClose?: () => void;
  /**
   * Dismiss handler for the result screen's "Close" button after an order is
   * submitted — e.g. to jump to the marketplace to see the new pending order.
   * Separate from {@link onClose} so a wallet-launched form can send the result
   * "Close" somewhere different from its back button. Falls back to `onClose`.
   */
  onDone?: () => void;
  style?: StyleProp<ViewStyle>;
  styles?: SellOrderFormStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    // ── Step 1: asset list ────────────────────────────────────────────────
    updatedRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    refreshButton: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
    },
    refreshText: {
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeSm,
    },
    placeholder: { color: theme.colors.textMuted },
    sectionHeader: {
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
      color: theme.colors.textMuted,
      fontWeight: "600",
      textTransform: "uppercase",
      fontSize: theme.typography.fontSizeSm,
      letterSpacing: 0.5,
    },
    // A plain (chrome-less) row on the screen background — no card fill — so the
    // asset list reads as a bare list rather than an elevated panel.
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: theme.borderWidth,
      borderBottomColor: theme.colors.border,
    },
    itemText: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "500",
    },
    chevron: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeLg,
    },

    // ── Step 2: asset detail (big, mobile-first) ──────────────────────────
    // Header row: the "Sell" title on the left (same as step 1), the back button
    // pushed to the right.
    detailHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: theme.spacing.xs,
      paddingLeft: theme.spacing.md,
    },
    backChevron: {
      color: theme.colors.textMuted,
      fontSize: 26,
      lineHeight: 26,
      marginTop: -2,
    },
    backText: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "600",
    },
    assetHead: { alignItems: "center", gap: theme.spacing.sm },
    assetName: {
      fontSize: 22,
      fontWeight: "700",
      color: theme.colors.text,
      textAlign: "center",
    },
    balanceText: {
      fontSize: theme.typography.fontSizeBase,
      color: theme.colors.textMuted,
      textAlign: "center",
    },
    field: { gap: theme.spacing.xs },
    fieldLabel: {
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    // The oversized amount input — the star of the detail screen (large touch
    // target + big numerals, as modern trading/wallet apps do).
    bigInput: {
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      fontSize: 30,
      fontWeight: "700",
    },
    // Focused amount input: a slightly darker fill (a dark overlay over the
    // resting light-surface fill) so the active field reads as recessed.
    bigInputFocused: {
      backgroundColor: "rgba(0,0,0,0.25)",
      borderColor: theme.colors.textMuted,
    },
    maxButton: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
    },

    // ── Result step ───────────────────────────────────────────────────────
    pendingNote: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
      lineHeight: 20,
    },
    mempoolLink: {
      color: theme.colors.primary,
      fontWeight: "600",
    },
    trackList: {
      gap: theme.spacing.xs,
    },
  });
}

/**
 * The oversized quantity/price field. Tracks its own focus so the fill darkens
 * while active (see `bigInputFocused`). Stays UNCONTROLLED (`defaultValue`, no
 * `value`) — see the rationale in {@link SellOrderForm} — with the sanitized
 * value pushed up via `onChangeText`.
 */
function AmountInput({
  sheet,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { sheet: ReturnType<typeof createSheet> }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[sheet.bigInput, focused && sheet.bigInputFocused, style]}
    />
  );
}

export function SellOrderForm({
  defaultSatsPerVbyte,
  initialAsset,
  title,
  reviewPresentation = "modal",
  onSuccess,
  onError,
  onClose,
  onDone,
  style,
  styles: stylesProp,
}: SellOrderFormProps) {
  const theme = useTheme();
  const common = useCommonSheet();
  const { baseUrl } = useHorizonMarket();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const {
    showQuantity,
    submitDisabled,
    maxQuantity,
    lastFetchedAt,
    isFetching,
    refresh,
    step,
    formValues,
    setFormValues,
    submitForm,
    confirmAndSell,
    isSubmitting,
    goBack,
    retry,
    reset,
    steps,
    totalSteps,
    status,
    error,
    nonFatalErrors,
    assetGroups,
    resultView,
  } = useSellOrderFormController({ defaultSatsPerVbyte, initialAsset, onSuccess, onError });

  // Fee rate + cost preview + live price for the review screen. Idle until the
  // confirm step is shown.
  const review = useSellReview({
    formValues,
    defaultSatsPerVbyte,
    active: step === "confirm",
  });

  // Launched for a specific balance (e.g. the wallet's Sell action) → open
  // straight to the detail step; the back button then dismisses (`onClose`)
  // rather than returning to an asset list the caller never showed.
  const launched = initialAsset != null;
  const [screen, setScreen] = useState<"list" | "detail">(
    launched ? "detail" : "list",
  );

  // The numeric fields are UNCONTROLLED (defaultValue, no `value`). Passing a
  // controlled `value` makes React write the field's text down to the native input
  // on every re-render; on iOS/Fabric that write races the keystroke and wipes the
  // character just typed — the field looks like it clears on every key. (Android
  // keeps its own native EditText text, so it never reproduced there.) With no
  // `value` prop nothing is written back to native mid-typing, so the input can't be
  // clobbered; onChangeText still pushes the sanitized value up to the controller,
  // which owns validation and the confirm/review step. Two nonces remount the
  // uncontrolled inputs when their text must change programmatically:
  //   - `qtyNonce` remounts ONLY the quantity field, so the Max button can push a
  //     new defaultValue into it without disturbing a typed price.
  //   - `formNonce` remounts BOTH fields on a full reset (New order / switching
  //     asset). Required because in modal mode the detail screen never unmounts
  //     (the review pops OVER it), so a bare `reset()` clears `formValues` yet
  //     leaves the native inputs showing the old text — a filled-looking but
  //     disabled form. Bumping `formNonce` re-applies the now-empty defaultValue.
  const [qtyNonce, setQtyNonce] = useState(0);
  const [formNonce, setFormNonce] = useState(0);

  const asset = formValues.asset;
  const onDetail = screen === "detail" && asset != null;

  const selectAsset = (item: AssetOption) => {
    // Start each asset's detail with empty fields rather than carrying over the
    // quantity/price typed for a previously viewed asset. The detail screen mounts
    // fresh on the list→detail switch, so clearing the values suffices (no nonce).
    setFormValues({ asset: item, quantity: "", priceSats: "" });
    setScreen("detail");
  };

  const backFromDetail = () => {
    if (launched) {
      onClose?.();
      return;
    }
    setFormValues({ asset: null });
    setScreen("list");
  };

  // "New order" on the result screen. Browse mode returns to the asset list;
  // launched mode re-seeds the original asset and returns to its detail step.
  const newOrder = () => {
    reset();
    // In modal mode the detail screen stays mounted across confirm→result, so
    // remount both inputs to clear their now-stale native text (reset() only
    // clears formValues). Harmless in browse mode (returns to the list anyway).
    setFormNonce((n) => n + 1);
    if (launched && initialAsset) {
      setFormValues({ asset: initialAsset });
      setScreen("detail");
    } else {
      setScreen("list");
    }
  };

  // The confirm → progress → result phase, presented either in a Modal or inline.
  const reviewOpen =
    step === "confirm" || step === "progress" || step === "result";

  const closeReview = () => {
    if (isSubmitting) return; // block dismissal while the tx is broadcasting
    if (step === "confirm") goBack();
    else if (step === "result") (status === "error" ? goBack : newOrder)();
  };

  const reviewTitle =
    step === "confirm"
      ? "Review order"
      : step === "progress"
        ? "Listing…"
        : status === "error"
          ? "Order failed"
          : "Order submitted";

  const reviewStyles = {
    button: stylesProp?.button,
    buttonText: stylesProp?.buttonText,
    buttonSecondary: stylesProp?.buttonSecondary,
    buttonSecondaryText: stylesProp?.buttonSecondaryText,
  };

  const reviewBody =
    step === "confirm" && asset ? (
      <SellReview
        asset={asset}
        quantity={formValues.quantity}
        priceSats={Number(formValues.priceSats)}
        review={review}
        isSubmitting={isSubmitting}
        onSign={() => void confirmAndSell({ satsPerVbyte: review.feeRate })}
        onCancel={goBack}
        styles={reviewStyles}
      />
    ) : step === "progress" ? (
      <WorkflowProgress
        steps={steps}
        totalSteps={totalSteps}
        status={status}
        styles={stylesProp?.progress}
      />
    ) : (
      <View style={{ gap: theme.spacing.md }}>
        <WorkflowProgress
          steps={steps}
          totalSteps={totalSteps}
          status={status}
          successMessage={resultView.successMessage}
          errorMessage={error?.message}
          styles={stylesProp?.progress}
        />
        {resultView.pendingConfirmation && (
          <Text style={sheet.pendingNote}>
            Your order will appear in the marketplace once its transaction is
            confirmed on-chain.
          </Text>
        )}
        {resultView.trackTxs.length > 0 && (
          <View style={sheet.trackList}>
            {resultView.trackTxs.map((tx) => (
              <Text
                key={tx.url}
                style={sheet.mempoolLink}
                onPress={() => Linking.openURL(tx.url)}
              >
                {tx.label}
              </Text>
            ))}
          </View>
        )}
        <ResultActions
          isError={status === "error"}
          onBack={goBack}
          onRetry={retry}
          onComplete={newOrder}
          completeLabel="New order"
          // The result "Close" can go somewhere different from the back button
          // (e.g. the marketplace), falling back to `onClose` when unset.
          onClose={onDone ?? onClose}
          sheet={common}
          styles={reviewStyles}
        />
      </View>
    );

  // The optional "Sell" heading, shown on both steps (list top + detail header).
  const titleNode =
    title == null ? null : typeof title === "string" ? (
      <Text style={[sheet.assetName, { textAlign: "left" }]}>{title}</Text>
    ) : (
      title
    );

  // ── Step 1: asset list ────────────────────────────────────────────────
  const listScreen = (
    <>
      {titleNode}
      <View style={sheet.updatedRow}>
        <Text style={[common.muted, stylesProp?.label]}>
          Updated {formatRelativeTime(lastFetchedAt)}
        </Text>
        <Pressable
          disabled={isFetching}
          onPress={refresh}
          style={[
            sheet.refreshButton,
            isFetching && common.buttonDisabled,
            stylesProp?.buttonSecondary,
          ]}
        >
          <Text style={[sheet.refreshText, stylesProp?.buttonSecondaryText]}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
      </View>
      {nonFatalErrors.length > 0 && (
        <Text style={[common.error, stylesProp?.error]}>
          {nonFatalErrors.join(" · ")}
        </Text>
      )}
      {assetGroups.length === 0 ? (
        <Text style={sheet.placeholder}>
          {isFetching ? "Loading your assets…" : "No assets to sell"}
        </Text>
      ) : (
        assetGroups.map((group) => (
          <View key={group.label}>
            <Text style={sheet.sectionHeader}>{group.label}</Text>
            {group.options.map((item) => (
              <Pressable
                key={assetKey(item)}
                onPress={() => selectAsset(item)}
                style={sheet.item}
                accessibilityRole="button"
                accessibilityLabel={`Sell ${describeAsset(item)}`}
              >
                <AssetAvatar
                  asset={item}
                  imageUrl={assetImageUrl(baseUrl, item)}
                  size={40}
                  radius={12}
                />
                <Text
                  numberOfLines={1}
                  style={[sheet.itemText, stylesProp?.dropdownText]}
                >
                  {describeAsset(item)}
                </Text>
                <Text style={sheet.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        ))
      )}
    </>
  );

  // ── Step 2: asset detail ──────────────────────────────────────────────
  const balanceLabel = asset ? assetBalanceLabel(asset) : "";
  const detailScreen = asset && (
    <>
      <View style={sheet.detailHeader}>
        {titleNode ?? <View />}
        <Pressable
          onPress={backFromDetail}
          style={sheet.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={sheet.backChevron}>‹</Text>
          <Text style={sheet.backText}>Back</Text>
        </Pressable>
      </View>

      <View style={sheet.assetHead}>
        <AssetAvatar
          asset={asset}
          imageUrl={assetImageUrl(baseUrl, asset)}
          size={96}
          radius={22}
        />
        <Text style={sheet.assetName} numberOfLines={1}>
          {sellingDisplay(asset, "").name}
        </Text>
        {balanceLabel ? (
          <Text style={sheet.balanceText}>Available {balanceLabel}</Text>
        ) : null}
      </View>

      {showQuantity && (
        <View style={sheet.field}>
          <Text style={sheet.fieldLabel}>Quantity</Text>
          <AmountInput
            key={`qty-${formNonce}-${qtyNonce}`}
            sheet={sheet}
            defaultValue={formValues.quantity}
            onChangeText={(t) =>
              setFormValues({ quantity: t.replace(/[^0-9.]/g, "") })
            }
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={theme.colors.textMuted}
            style={stylesProp?.input}
          />
          {maxQuantity && (
            <Pressable
              onPress={() => {
                setFormValues({ quantity: maxQuantity });
                setQtyNonce((n) => n + 1);
              }}
              style={[sheet.maxButton, stylesProp?.buttonSecondary]}
            >
              <Text style={[sheet.refreshText, stylesProp?.buttonSecondaryText]}>
                Max ({maxQuantity})
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={sheet.field}>
        <Text style={sheet.fieldLabel}>Price (sats)</Text>
        <AmountInput
          key={`price-${formNonce}`}
          sheet={sheet}
          defaultValue={formValues.priceSats}
          onChangeText={(t) =>
            setFormValues({ priceSats: t.replace(/[^0-9]/g, "") })
          }
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={theme.colors.textMuted}
          style={stylesProp?.input}
        />
      </View>

      {error && (
        <Text style={[common.error, stylesProp?.error]}>{error.message}</Text>
      )}

      <Pressable
        disabled={submitDisabled}
        onPress={submitForm}
        style={[
          common.button,
          submitDisabled && common.buttonDisabled,
          stylesProp?.button,
        ]}
      >
        <Text style={[common.buttonText, stylesProp?.buttonText]}>
          Review Order
        </Text>
      </Pressable>
    </>
  );

  const formPhase = onDetail ? detailScreen : listScreen;

  // Inline review (hosted inside a caller's modal): swap the form for the review
  // in place so a second modal isn't stacked on top.
  if (reviewPresentation === "inline") {
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
        {reviewOpen ? reviewBody : formPhase}
      </View>
    );
  }

  // Modal review (default): the form stays put and the review pops over it —
  // exactly like the buy confirmation modal.
  return (
    <View style={[common.panelBody, style, stylesProp?.root]}>
      {formPhase}
      <Modal open={reviewOpen} onClose={closeReview} title={reviewTitle}>
        {reviewBody}
      </Modal>
    </View>
  );
}
