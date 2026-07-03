import { useMemo, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import { useTheme } from "../hooks/useTheme.js";
import {
  assetImageUrl,
  assetKey,
  counterpartyXcpFirst,
  describeAsset,
  formatRelativeTime,
  kontorKorFirst,
} from "../internal/format.js";
import { AssetAvatar } from "../internal/icons.native.js";
import { ResultActions } from "../internal/ResultActions.native.js";
import { SellReview } from "../internal/SellReview.native.js";
import { useCommonSheet } from "../internal/styles.native.js";
import { useSellOrderFormController } from "../internal/useSellOrderFormController.js";
import { useSellReview } from "../internal/useSellReview.js";
import type { ResolvedTheme } from "../theme.js";
import {
  WorkflowProgress,
  type WorkflowProgressStyles,
} from "./WorkflowProgress.native.js";

export interface SellOrderFormStyles {
  root?: StyleProp<ViewStyle>;
  label?: StyleProp<TextStyle>;
  input?: StyleProp<TextStyle>;
  dropdown?: StyleProp<ViewStyle>;
  dropdownText?: StyleProp<TextStyle>;
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
  buttonSecondary?: StyleProp<ViewStyle>;
  buttonSecondaryText?: StyleProp<TextStyle>;
  summary?: StyleProp<ViewStyle>;
  progress?: WorkflowProgressStyles;
  error?: StyleProp<TextStyle>;
}

export interface SellOrderFormProps {
  defaultSatsPerVbyte?: number;
  /** Pre-select an asset to list (e.g. launched from a wallet balance). */
  initialAsset?: AssetOption | null;
  onSuccess?: (swap: AtomicSwap, created: boolean) => void;
  onError?: (error: Error) => void;
  /**
   * Dismiss handler. When provided, the result screen shows a "Close" button
   * beside "New order" (e.g. to close the surrounding modal).
   */
  onClose?: () => void;
  style?: StyleProp<ViewStyle>;
  styles?: SellOrderFormStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    dropdown: {
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.background,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
    },
    dropdownText: {
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
    },
    placeholder: { color: theme.colors.textMuted },
    modalContainer: { flex: 1, justifyContent: "flex-end" },
    modalBackdrop: { backgroundColor: "rgba(0,0,0,0.5)" },
    modalSheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radii.lg,
      borderTopRightRadius: theme.radii.lg,
      padding: theme.spacing.md,
      maxHeight: "80%",
    },
    sectionHeader: {
      paddingVertical: theme.spacing.sm,
      color: theme.colors.textMuted,
      fontWeight: "600",
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderBottomWidth: theme.borderWidth,
      borderBottomColor: theme.colors.border,
    },
    updatedRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: theme.spacing.sm,
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
    maxButton: {
      marginTop: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
      alignSelf: "flex-start",
    },
    pendingNote: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
      lineHeight: 20,
    },
    mempoolLink: {
      color: theme.colors.primary,
      fontWeight: "600",
    },
  });
}

export function SellOrderForm({
  defaultSatsPerVbyte,
  initialAsset,
  onSuccess,
  onError,
  onClose,
  style,
  styles: stylesProp,
}: SellOrderFormProps) {
  const theme = useTheme();
  const common = useCommonSheet();
  const { baseUrl } = useHorizonMarket();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const {
    assets,
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
    assetPlaceholder,
    nonFatalErrors,
    resultView,
  } = useSellOrderFormController({ defaultSatsPerVbyte, initialAsset, onSuccess, onError });

  // Fee rate + cost preview + live price for the review screen. Idle until the
  // confirm step is shown.
  const review = useSellReview({
    formValues,
    defaultSatsPerVbyte,
    active: step === "confirm",
  });

  const [pickerOpen, setPickerOpen] = useState(false);

  const sections = useMemo(
    () =>
      [
        {
          title: "Counterparty",
          data: counterpartyXcpFirst(assets.counterpartyAssets),
        },
        { title: "ZELD", data: assets.zeldAssets },
        {
          title: "Kontor",
          data: kontorKorFirst([...assets.korAssets, ...assets.kontorNfts]),
        },
        { title: "Ordinals", data: assets.ordinals },
      ].filter((s) => s.data.length > 0),
    [
      assets.counterpartyAssets,
      assets.zeldAssets,
      assets.korAssets,
      assets.kontorNfts,
      assets.ordinals,
    ],
  );

  if (step === "form") {
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
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
        <View>
          <Text style={[common.label, stylesProp?.label]}>Asset</Text>
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={[sheet.dropdown, stylesProp?.dropdown]}
          >
            <Text
              style={[
                sheet.dropdownText,
                !formValues.asset && sheet.placeholder,
                stylesProp?.dropdownText,
              ]}
            >
              {formValues.asset
                ? describeAsset(formValues.asset)
                : assetPlaceholder}
            </Text>
          </Pressable>
        </View>
        {nonFatalErrors.length > 0 && (
          <Text style={[common.error, stylesProp?.error]}>
            {nonFatalErrors.join(" · ")}
          </Text>
        )}
        {showQuantity && (
          <View>
            <Text style={[common.label, stylesProp?.label]}>Quantity</Text>
            <TextInput
              value={formValues.quantity}
              onChangeText={(t) =>
                setFormValues({ quantity: t.replace(/[^0-9.]/g, "") })
              }
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={theme.colors.textMuted}
              style={[common.input, stylesProp?.input]}
            />
            {maxQuantity && (
              <Pressable
                onPress={() => setFormValues({ quantity: maxQuantity })}
                style={[sheet.maxButton, stylesProp?.buttonSecondary]}
              >
                <Text
                  style={[sheet.refreshText, stylesProp?.buttonSecondaryText]}
                >
                  Max ({maxQuantity})
                </Text>
              </Pressable>
            )}
          </View>
        )}
        <View>
          <Text style={[common.label, stylesProp?.label]}>Price (sats)</Text>
          <TextInput
            value={formValues.priceSats}
            onChangeText={(t) =>
              setFormValues({ priceSats: t.replace(/[^0-9]/g, "") })
            }
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={theme.colors.textMuted}
            style={[common.input, stylesProp?.input]}
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

        <Modal
          visible={pickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setPickerOpen(false)}
        >
          <View style={sheet.modalContainer}>
            <Pressable
              style={[StyleSheet.absoluteFill, sheet.modalBackdrop]}
              onPress={() => setPickerOpen(false)}
            />
            <View style={sheet.modalSheet} onStartShouldSetResponder={() => true}>
              <SectionList
                sections={sections}
                keyExtractor={(item) => assetKey(item)}
                keyboardShouldPersistTaps="handled"
                renderSectionHeader={({ section }) => (
                  <Text style={sheet.sectionHeader}>{section.title}</Text>
                )}
                renderItem={({ item }: { item: AssetOption }) => (
                  <Pressable
                    onPress={() => {
                      setFormValues({ asset: item });
                      setPickerOpen(false);
                    }}
                    style={sheet.item}
                  >
                    <AssetAvatar
                      asset={item}
                      imageUrl={assetImageUrl(baseUrl, item)}
                      size={32}
                      radius={16}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        sheet.dropdownText,
                        { flex: 1 },
                        stylesProp?.dropdownText,
                      ]}
                    >
                      {describeAsset(item)}
                    </Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={sheet.placeholder}>
                    {isFetching ? "Loading your assets…" : "No assets to sell"}
                  </Text>
                }
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  if (step === "confirm" && formValues.asset) {
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
        <SellReview
          asset={formValues.asset}
          quantity={formValues.quantity}
          priceSats={Number(formValues.priceSats)}
          review={review}
          isSubmitting={isSubmitting}
          onSign={() => void confirmAndSell({ satsPerVbyte: review.feeRate })}
          onCancel={goBack}
          styles={{
            button: stylesProp?.button,
            buttonText: stylesProp?.buttonText,
            buttonSecondary: stylesProp?.buttonSecondary,
            buttonSecondaryText: stylesProp?.buttonSecondaryText,
          }}
        />
      </View>
    );
  }

  if (step === "progress") {
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
        <WorkflowProgress
          steps={steps}
          totalSteps={totalSteps}
          status={status}
          styles={stylesProp?.progress}
        />
      </View>
    );
  }

  return (
    <View style={[common.panelBody, style, stylesProp?.root]}>
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
          {resultView.trackUrl && (
            <Text
              style={sheet.mempoolLink}
              onPress={() => Linking.openURL(resultView.trackUrl!)}
            >
              {" "}
              Track it on mempool.space →
            </Text>
          )}
        </Text>
      )}
      <ResultActions
        isError={status === "error"}
        onBack={goBack}
        onRetry={retry}
        onComplete={reset}
        completeLabel="New order"
        onClose={onClose}
        sheet={common}
        styles={{
          button: stylesProp?.button,
          buttonText: stylesProp?.buttonText,
          buttonSecondary: stylesProp?.buttonSecondary,
          buttonSecondaryText: stylesProp?.buttonSecondaryText,
        }}
      />
    </View>
  );
}
