import { useMemo, useState } from "react";
import {
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
import { useTheme } from "../hooks/useTheme.js";
import {
  assetKey,
  describeAsset,
  formatRelativeTime,
} from "../internal/format.js";
import { ResultActions } from "../internal/ResultActions.native.js";
import { useCommonSheet } from "../internal/styles.native.js";
import { SummaryRow } from "../internal/SummaryRow.native.js";
import { useSellOrderFormController } from "../internal/useSellOrderFormController.js";
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
  onSuccess?: (swap: AtomicSwap, created: boolean) => void;
  onError?: (error: Error) => void;
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
  });
}

export function SellOrderForm({
  defaultSatsPerVbyte,
  onSuccess,
  onError,
  style,
  styles: stylesProp,
}: SellOrderFormProps) {
  const theme = useTheme();
  const common = useCommonSheet();
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
    result,
    error,
  } = useSellOrderFormController({ defaultSatsPerVbyte, onSuccess, onError });

  const [pickerOpen, setPickerOpen] = useState(false);

  const sections = useMemo(
    () =>
      [
        { title: "Counterparty", data: assets.counterpartyAssets },
        { title: "ZELD", data: assets.zeldAssets },
        { title: "KOR", data: assets.korAssets },
        { title: "Kontor NFTs", data: assets.kontorNfts },
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

  const nonFatalErrors = [
    assets.errors.counterparty &&
      `Counterparty: ${assets.errors.counterparty.message}`,
    assets.errors.zeld && `ZELD: ${assets.errors.zeld.message}`,
    assets.errors.ordinals && `Ordinals: ${assets.errors.ordinals.message}`,
    assets.errors.kontor && `Kontor: ${assets.errors.kontor.message}`,
  ].filter((m): m is string => Boolean(m));

  if (step === "form") {
    return (
      <View style={[common.root, style, stylesProp?.root]}>
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
                : assets.isEmpty
                  ? "No assets to sell"
                  : "Select an asset…"}
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
                    <Text style={[sheet.dropdownText, stylesProp?.dropdownText]}>
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
    const showSummaryQuantity =
      formValues.asset.type !== "ordinal" &&
      formValues.asset.type !== "kontor-nft";
    return (
      <View style={[common.root, style, stylesProp?.root]}>
        <View style={[common.summaryStack, stylesProp?.summary]}>
          <SummaryRow
            label="Asset"
            value={describeAsset(formValues.asset)}
            sheet={common}
          />
          {showSummaryQuantity && (
            <SummaryRow
              label="Quantity"
              value={formValues.quantity}
              sheet={common}
            />
          )}
          <SummaryRow
            label="Price"
            value={`${Number(formValues.priceSats).toLocaleString()} sats`}
            sheet={common}
          />
        </View>
        <View style={common.actions}>
          <Pressable
            onPress={goBack}
            style={[
              common.buttonSecondary,
              common.flex1,
              stylesProp?.buttonSecondary,
            ]}
          >
            <Text
              style={[
                common.buttonSecondaryText,
                stylesProp?.buttonSecondaryText,
              ]}
            >
              Back
            </Text>
          </Pressable>
          <Pressable
            disabled={isSubmitting}
            onPress={() => void confirmAndSell()}
            style={[
              common.button,
              common.flex1,
              isSubmitting && common.buttonDisabled,
              stylesProp?.button,
            ]}
          >
            <Text style={[common.buttonText, stylesProp?.buttonText]}>
              {isSubmitting ? "Selling…" : "Sell"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (step === "progress") {
    return (
      <View style={[common.root, style, stylesProp?.root]}>
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
    <View style={[common.root, style, stylesProp?.root]}>
      <WorkflowProgress
        steps={steps}
        totalSteps={totalSteps}
        status={status}
        successMessage={
          status === "success" && result
            ? result.created
              ? "Your listing is live!"
              : "Listing already exists (no changes)."
            : undefined
        }
        errorMessage={error?.message}
        styles={stylesProp?.progress}
      />
      <ResultActions
        isError={status === "error"}
        onBack={goBack}
        onRetry={retry}
        onComplete={reset}
        completeLabel="New order"
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
