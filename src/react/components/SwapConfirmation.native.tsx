import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap, PendingSale } from "../../types/index.js";
import type { FillSwapsParams } from "../../workflows/buy.js";
import { useSwapConfirmation } from "../hooks/useSwapConfirmation.js";
import { formatAssetLabel, truncate } from "../internal/format.js";
import { ResultActions } from "../internal/ResultActions.native.js";
import { useCommonSheet } from "../internal/styles.native.js";
import { SummaryRow } from "../internal/SummaryRow.native.js";
import {
  WorkflowProgress,
  type WorkflowProgressStyles,
} from "./WorkflowProgress.native.js";

export interface SwapConfirmationStyles {
  root?: StyleProp<ViewStyle>;
  details?: StyleProp<ViewStyle>;
  row?: StyleProp<ViewStyle>;
  rowLabel?: StyleProp<TextStyle>;
  rowValue?: StyleProp<TextStyle>;
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
  buttonSecondary?: StyleProp<ViewStyle>;
  buttonSecondaryText?: StyleProp<TextStyle>;
  progress?: WorkflowProgressStyles;
}

export interface SwapConfirmationProps {
  swap: AtomicSwap;
  mode: "buy" | "sell";
  fillParams?: Partial<FillSwapsParams>;
  defaultSatsPerVbyte?: number;
  onBuySuccess?: (sales: PendingSale[]) => void;
  onDelistSuccess?: () => void;
  onError?: (error: Error) => void;
  style?: StyleProp<ViewStyle>;
  styles?: SwapConfirmationStyles;
}

export function SwapConfirmation({
  swap,
  mode,
  fillParams,
  defaultSatsPerVbyte,
  onBuySuccess,
  onDelistSuccess,
  onError,
  style,
  styles: stylesProp,
}: SwapConfirmationProps) {
  const common = useCommonSheet();
  const {
    step,
    buyStatus,
    delistStatus,
    buySteps,
    delistSteps,
    totalBuySteps,
    totalDelistSteps,
    sales,
    error,
    confirmPurchase,
    delist,
    retry,
    reset,
  } = useSwapConfirmation({
    swapId: swap.id,
    defaultSatsPerVbyte,
    onBuySuccess,
    onDelistSuccess,
    onError,
  });

  const status = mode === "buy" ? buyStatus : delistStatus;
  const steps = mode === "buy" ? buySteps : delistSteps;
  const totalSteps = mode === "buy" ? totalBuySteps : totalDelistSteps;

  if (step === "confirm") {
    return (
      <View style={[common.root, style, stylesProp?.root]}>
        <View style={[common.summaryStack, stylesProp?.details]}>
          <SummaryRow
            label="Asset"
            value={formatAssetLabel(swap)}
            sheet={common}
            mono
            rowStyle={stylesProp?.row}
            labelStyle={stylesProp?.rowLabel}
            valueStyle={stylesProp?.rowValue}
          />
          <SummaryRow
            label="Price"
            value={`${swap.price.toLocaleString()} sats`}
            sheet={common}
            mono
            rowStyle={stylesProp?.row}
            labelStyle={stylesProp?.rowLabel}
            valueStyle={stylesProp?.rowValue}
          />
          <SummaryRow
            label={mode === "buy" ? "Seller" : "Listing"}
            value={
              mode === "buy"
                ? truncate(swap.sellerAddress)
                : `${swap.listingType} · ${truncate(swap.id)}`
            }
            sheet={common}
            mono
            rowStyle={stylesProp?.row}
            labelStyle={stylesProp?.rowLabel}
            valueStyle={stylesProp?.rowValue}
          />
          {swap.expiresAt && (
            <SummaryRow
              label="Expires"
              value={new Date(swap.expiresAt).toLocaleString()}
              sheet={common}
              mono
              rowStyle={stylesProp?.row}
              labelStyle={stylesProp?.rowLabel}
              valueStyle={stylesProp?.rowValue}
            />
          )}
        </View>
        <Pressable
          onPress={() =>
            mode === "buy" ? void confirmPurchase(fillParams) : void delist()
          }
          style={[common.button, stylesProp?.button]}
        >
          <Text style={[common.buttonText, stylesProp?.buttonText]}>
            {mode === "buy" ? "Confirm Purchase" : "Delist"}
          </Text>
        </Pressable>
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

  const firstSale = sales?.[0];
  const successMessage =
    status === "success"
      ? mode === "buy"
        ? firstSale
          ? `Purchase complete! tx ${firstSale.txId.slice(0, 12)}…`
          : "Purchase complete!"
        : "Listing removed."
      : undefined;

  return (
    <View style={[common.root, style, stylesProp?.root]}>
      <WorkflowProgress
        steps={steps}
        totalSteps={totalSteps}
        status={status}
        successMessage={successMessage}
        errorMessage={error?.message}
        styles={stylesProp?.progress}
      />
      <ResultActions
        isError={status === "error"}
        onBack={reset}
        onRetry={retry}
        onComplete={reset}
        completeLabel="Done"
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
