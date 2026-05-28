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
import { useTheme } from "../hooks/useTheme.js";
import { assetKey, describeAsset } from "../internal/format.js";
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
    search,
    setSearch,
    showQuantity,
    submitDisabled,
    step,
    formValues,
    setFormValues,
    submitForm,
    confirmAndSell,
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
    () => [
      { title: "ZELD", data: [assets.zeldOption] },
      { title: "Counterparty", data: assets.counterpartyAssets },
      { title: "Ordinals", data: assets.ordinals },
    ],
    [assets.zeldOption, assets.counterpartyAssets, assets.ordinals],
  );

  if (step === "form") {
    return (
      <View style={[common.root, style, stylesProp?.root]}>
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
                : "Select an asset…"}
            </Text>
          </Pressable>
        </View>
        {showQuantity && (
          <View>
            <Text style={[common.label, stylesProp?.label]}>Quantity</Text>
            <TextInput
              value={formValues.quantity}
              onChangeText={(t) =>
                setFormValues({ quantity: t.replace(/[^0-9]/g, "") })
              }
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.colors.textMuted}
              style={[common.input, stylesProp?.input]}
            />
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
            <View style={sheet.modalSheet}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search…"
                placeholderTextColor={theme.colors.textMuted}
                style={[common.input, stylesProp?.input]}
              />
              <SectionList
                sections={sections}
                keyExtractor={(item) => assetKey(item)}
                renderSectionHeader={({ section }) => (
                  <Text style={sheet.sectionHeader}>{section.title}</Text>
                )}
                renderItem={({ item }) => (
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
                  <Text style={sheet.placeholder}>No assets</Text>
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
      <View style={[common.root, style, stylesProp?.root]}>
        <View style={[common.summaryStack, stylesProp?.summary]}>
          <SummaryRow
            label="Asset"
            value={describeAsset(formValues.asset)}
            sheet={common}
          />
          {formValues.asset.type !== "ordinal" && (
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
            onPress={() => void confirmAndSell()}
            style={[common.button, common.flex1, stylesProp?.button]}
          >
            <Text style={[common.buttonText, stylesProp?.buttonText]}>
              Sell
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
