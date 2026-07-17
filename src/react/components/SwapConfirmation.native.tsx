import { useMemo } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap, PendingSale } from "../../types/index.js";
import type { FillSwapsParams } from "../../workflows/buy.js";
import { useSwapConfirmation } from "../hooks/useSwapConfirmation.js";
import { useHorizonMarket } from "../context.js";
import {
  errorDisplayMessage,
  formatAssetLabel,
  truncate,
} from "../internal/format.js";
import { BuyReview } from "../internal/BuyReview.native.js";
import { useBuyReview } from "../internal/useBuyReview.js";
import { ResultActions } from "../internal/ResultActions.native.js";
import { useCommonSheet } from "../internal/styles.native.js";
import { SummaryRow } from "../internal/SummaryRow.native.js";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
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
  /** Called when the user dismisses the result screen (clicks "Done"). */
  onComplete?: () => void;
  style?: StyleProp<ViewStyle>;
  styles?: SwapConfirmationStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
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

export function SwapConfirmation({
  swap,
  mode,
  fillParams,
  defaultSatsPerVbyte,
  onBuySuccess,
  onDelistSuccess,
  onError,
  onComplete,
  style,
  styles: stylesProp,
}: SwapConfirmationProps) {
  const common = useCommonSheet();
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const {
    step,
    status,
    steps,
    totalSteps,
    successMessage,
    trackUrl,
    error,
    confirmPurchase,
    delist,
    isSubmitting,
    retry,
    reset,
  } = useSwapConfirmation({
    swapId: swap.id,
    mode,
    defaultSatsPerVbyte,
    onBuySuccess,
    onDelistSuccess,
    onError,
  });

  // Buy review: compose the quote (price / royalty / miner fee / total) and let
  // the buyer pick a fee rate, only while the confirm step is shown.
  const buyReview = useBuyReview({
    swap,
    defaultSatsPerVbyte,
    active: step === "confirm" && mode === "buy",
  });

  // Ordinals must be received on a taproot address. Auto-fill it from the
  // connected wallet so callers (e.g. SwapList) don't have to thread fillParams;
  // an explicit fillParams.buyerTaprootAddress still wins.
  const { addresses } = useHorizonMarket();
  const buyerTaprootAddress =
    swap.listingType === "ordinal" ? addresses?.p2tr : undefined;

  if (step === "confirm" && mode === "buy") {
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
        <BuyReview
          swap={swap}
          review={buyReview}
          isSubmitting={isSubmitting}
          onConfirm={() =>
            void confirmPurchase({
              ...(buyerTaprootAddress ? { buyerTaprootAddress } : {}),
              ...fillParams,
              ...(buyReview.feeRate != null
                ? { satsPerVbyte: buyReview.feeRate }
                : {}),
            })
          }
          onCancel={onComplete}
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

  if (step === "confirm") {
    // Delist confirmation (mode === "sell") — a compact summary of the listing
    // the seller is removing. (Buy is handled by the BuyReview branch above.)
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
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
            value={`${swap.price.toLocaleString("en-US")} sats`}
            sheet={common}
            mono
            rowStyle={stylesProp?.row}
            labelStyle={stylesProp?.rowLabel}
            valueStyle={stylesProp?.rowValue}
          />
          <SummaryRow
            label="Listing"
            value={`${swap.listingType} · ${truncate(swap.id)}`}
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
          disabled={isSubmitting}
          onPress={() => void delist()}
          style={[
            common.button,
            isSubmitting && common.buttonDisabled,
            stylesProp?.button,
          ]}
        >
          <Text style={[common.buttonText, stylesProp?.buttonText]}>
            {isSubmitting ? "Delisting…" : "Delist"}
          </Text>
        </Pressable>
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
        successMessage={successMessage}
        errorMessage={error ? errorDisplayMessage(error) : undefined}
        styles={stylesProp?.progress}
      />
      {trackUrl && (
        <Text style={sheet.pendingNote}>
          Your purchase is settling on-chain.
          <Text
            style={sheet.mempoolLink}
            onPress={() => Linking.openURL(trackUrl)}
          >
            {" "}
            Track it on mempool.space →
          </Text>
        </Text>
      )}
      <ResultActions
        isError={status === "error"}
        onBack={reset}
        onRetry={retry}
        onComplete={() => { reset(); onComplete?.(); }}
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
