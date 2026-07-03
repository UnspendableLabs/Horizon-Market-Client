import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
import {
  assetImageUrl,
  assetKey,
  formatRelativeTime,
  truncate,
} from "../internal/format.js";
import {
  CheckIcon,
  CopyIcon,
  DepositIcon,
  NoImageIcon,
  SellIcon,
  WithdrawIcon,
} from "../internal/icons.native.js";
import {
  TokenMark,
  type TokenLine,
} from "../internal/walletBalances.native.js";
import {
  ACTION_LABEL,
  otherLabel,
  tokenDepositType,
  useWalletBalancesController,
  withdrawKey,
  withdrawTitle,
  type ActionKind,
  type DepositType,
} from "../internal/useWalletBalancesController.js";
import { Modal } from "./Modal.native.js";
import { SellOrderForm } from "./SellOrderForm.native.js";
import { WithdrawForm } from "./WithdrawForm.native.js";

export interface WalletBalancesStyles {
  root?: StyleProp<ViewStyle>;
  header?: StyleProp<ViewStyle>;
  /** The "Refresh" control in the header. */
  buttonSecondary?: StyleProp<ViewStyle>;
  btc?: StyleProp<ViewStyle>;
  token?: StyleProp<ViewStyle>;
  tile?: StyleProp<ViewStyle>;
  /** The Counterparty · Kontor · Ordinals tab row. */
  groupHeader?: StyleProp<ViewStyle>;
}

export interface WalletBalancesProps {
  /** Optional heading rendered at the top-left of the header row. */
  title?: ReactNode;
  style?: StyleProp<ViewStyle>;
  styles?: WalletBalancesStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    root: { gap: 20 },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.md,
      flexWrap: "wrap",
    },
    headerMeta: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
    updated: { fontSize: theme.typography.fontSizeSm, color: theme.colors.textMuted },
    refreshButton: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: theme.radii.md,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
    },
    refreshText: { fontSize: 12, color: theme.colors.text, fontWeight: "600" },
    section: { gap: theme.spacing.md },
    sectionTitle: { fontSize: theme.typography.fontSizeLg, fontWeight: "700", color: theme.colors.text },
    addressList: { gap: theme.spacing.md },
    addressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.md,
    },
    addressLabel: { width: 108, fontSize: theme.typography.fontSizeBase, fontWeight: "600", color: theme.colors.textMuted },
    addressValue: { flex: 1, fontFamily: "monospace", fontSize: theme.typography.fontSizeBase, color: theme.colors.text },
    // BTC headline card.
    btcCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.md,
      paddingHorizontal: 20,
      paddingVertical: 20,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.lg,
    },
    balanceInfo: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, flexShrink: 1 },
    btcAmount: { fontSize: 26, fontWeight: "700", color: theme.colors.text },
    btcUnit: { fontSize: 15, fontWeight: "600", color: theme.colors.textMuted },
    btcUsd: { marginTop: 2, fontSize: theme.typography.fontSizeSm, color: theme.colors.textMuted },
    // XCP/KOR/ZELD headline rows (stacked full-width cards on mobile).
    tokenCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      paddingHorizontal: 18,
      paddingVertical: 16,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.lg,
    },
    tokenAmount: { fontSize: 18, fontWeight: "700", color: theme.colors.text },
    tokenSymbol: { marginTop: 2, fontSize: theme.typography.fontSizeBase, color: theme.colors.textMuted },
    actionRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
    labeledAction: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      height: 30,
      paddingHorizontal: 10,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
    },
    labeledActionText: { fontSize: theme.typography.fontSizeSm, fontWeight: "600", color: theme.colors.text },
    iconAction: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
    },
    disabled: { opacity: 0.4 },
    // Tabs for the "other holdings" groups.
    tabRow: { flexDirection: "row", alignItems: "flex-end", gap: theme.spacing.lg, flexWrap: "wrap" },
    tab: { paddingBottom: theme.spacing.sm, borderBottomWidth: 2, borderBottomColor: "transparent" },
    tabActive: { borderBottomColor: theme.colors.primary },
    tabText: { fontSize: theme.typography.fontSizeBase, fontWeight: "700", color: theme.colors.textMuted },
    tabTextActive: { color: theme.colors.text },
    emptyOthers: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, flexWrap: "wrap" },
    emptyText: { color: theme.colors.textMuted, fontSize: theme.typography.fontSizeSm },
    // Other-holdings tiles: 2-column flex-wrap.
    tilesWrap: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
    tile: { width: "47%", gap: theme.spacing.sm, flexGrow: 1 },
    media: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: theme.radii.md,
      backgroundColor: "rgba(0,0,0,0.33)",
    },
    mediaPlaceholder: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: theme.radii.md,
      backgroundColor: "rgba(0,0,0,0.33)",
      alignItems: "center",
      justifyContent: "center",
    },
    tileName: { fontWeight: "600", color: theme.colors.text },
    tileFooter: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
    tileBalance: { flexShrink: 1, fontSize: theme.typography.fontSizeSm, color: theme.colors.text },
    tileActions: { flexDirection: "row", gap: 6, marginLeft: "auto" },
    // Deposit modal.
    depositHint: { color: theme.colors.textMuted, fontSize: theme.typography.fontSizeSm, lineHeight: 20 },
    depositLabel: { fontSize: theme.typography.fontSizeSm, color: theme.colors.textMuted, marginBottom: theme.spacing.xs },
    addressBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.background,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
    },
    addressBoxText: { flex: 1, fontFamily: "monospace", fontSize: theme.typography.fontSizeSm, color: theme.colors.text },
    copyButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
    },
  });
}

type Sheet = ReturnType<typeof createSheet>;

/** Copies text to the clipboard, flashing a check for 1.5s. */
function CopyButton({ value, sheet, color }: { value: string; sheet: Sheet; color: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void Clipboard.setStringAsync(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <Pressable onPress={onCopy} style={sheet.copyButton} accessibilityLabel="Copy address">
      {copied ? <CheckIcon size={14} color={color} /> : <CopyIcon size={14} color={color} />}
    </Pressable>
  );
}

function ActionGlyph({ kind, size, color }: { kind: ActionKind; size: number; color: string }) {
  if (kind === "deposit") return <DepositIcon size={size} color={color} />;
  if (kind === "withdraw") return <WithdrawIcon size={size} color={color} />;
  return <SellIcon size={size} color={color} />;
}

function LabeledAction({
  kind,
  disabled,
  onPress,
  sheet,
  color,
}: {
  kind: ActionKind;
  disabled?: boolean;
  onPress: () => void;
  sheet: Sheet;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[sheet.labeledAction, disabled && sheet.disabled]}
    >
      <ActionGlyph kind={kind} size={14} color={color} />
      <Text style={sheet.labeledActionText}>{ACTION_LABEL[kind]}</Text>
    </Pressable>
  );
}

function IconAction({
  kind,
  disabled,
  onPress,
  sheet,
  color,
}: {
  kind: ActionKind;
  disabled?: boolean;
  onPress: () => void;
  sheet: Sheet;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[sheet.iconAction, disabled && sheet.disabled]}
      accessibilityLabel={ACTION_LABEL[kind]}
    >
      <ActionGlyph kind={kind} size={16} color={color} />
    </Pressable>
  );
}

function AddressRow({ label, address, sheet, color }: { label: string; address: string; sheet: Sheet; color: string }) {
  return (
    <View style={sheet.addressRow}>
      <Text style={sheet.addressLabel}>{label}</Text>
      <Text style={sheet.addressValue} numberOfLines={1}>
        {truncate(address, 12, 8)}
      </Text>
      <CopyButton value={address} sheet={sheet} color={color} />
    </View>
  );
}

/** Square artwork panel with a placeholder fallback (swap-list style). */
function AssetMedia({ asset, sheet, mutedColor }: { asset: AssetOption; sheet: Sheet; mutedColor: string }) {
  const { baseUrl } = useHorizonMarket();
  const [errored, setErrored] = useState(false);
  const url = assetImageUrl(baseUrl, asset, "image");
  if (url && !errored) {
    return (
      <Image
        source={{ uri: url }}
        onError={() => setErrored(true)}
        resizeMode="contain"
        style={sheet.media}
      />
    );
  }
  return (
    <View style={sheet.mediaPlaceholder}>
      <NoImageIcon size={28} color={mutedColor} />
    </View>
  );
}

function OtherAssetTile({
  asset,
  onDeposit,
  onWithdraw,
  onSell,
  sheet,
  color,
  mutedColor,
  styleProp,
}: {
  asset: AssetOption;
  onDeposit: (asset: AssetOption) => void;
  onWithdraw: (asset: AssetOption) => void;
  onSell: (asset: AssetOption) => void;
  sheet: Sheet;
  color: string;
  mutedColor: string;
  styleProp?: StyleProp<ViewStyle>;
}) {
  const { name, sub } = otherLabel(asset);
  return (
    <View style={[sheet.tile, styleProp]}>
      <AssetMedia asset={asset} sheet={sheet} mutedColor={mutedColor} />
      <Text style={sheet.tileName}>{name}</Text>
      <View style={sheet.tileFooter}>
        {sub ? (
          <Text style={sheet.tileBalance} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
        <View style={sheet.tileActions}>
          <IconAction kind="deposit" onPress={() => onDeposit(asset)} sheet={sheet} color={color} />
          <IconAction kind="withdraw" onPress={() => onWithdraw(asset)} sheet={sheet} color={color} />
          <IconAction kind="sell" onPress={() => onSell(asset)} sheet={sheet} color={color} />
        </View>
      </View>
    </View>
  );
}

/** XCP / KOR / ZELD headline card: brand mark + amount + Deposit/Withdraw/Sell. */
function TokenCell({
  line,
  onDeposit,
  onWithdraw,
  onSell,
  sheet,
  color,
  styleProp,
}: {
  line: TokenLine;
  onDeposit: (symbol: string, type: DepositType) => void;
  onWithdraw: (asset: AssetOption) => void;
  onSell: (asset: AssetOption) => void;
  sheet: Sheet;
  color: string;
  styleProp?: StyleProp<ViewStyle>;
}) {
  const depositType = tokenDepositType(line.symbol);
  const sellAsset = line.sellAsset;
  return (
    <View style={[sheet.tokenCard, styleProp]}>
      <View style={sheet.balanceInfo}>
        <TokenMark line={line} size={38} />
        <View style={{ flexShrink: 1 }}>
          <Text style={sheet.tokenAmount} numberOfLines={1}>
            {line.amount ?? "…"}
          </Text>
          <Text style={sheet.tokenSymbol}>{line.symbol}</Text>
        </View>
      </View>
      <View style={sheet.actionRow}>
        <IconAction kind="deposit" onPress={() => onDeposit(line.symbol, depositType)} sheet={sheet} color={color} />
        <IconAction
          kind="withdraw"
          disabled={!sellAsset}
          onPress={() => sellAsset && onWithdraw(sellAsset)}
          sheet={sheet}
          color={color}
        />
        <LabeledAction
          kind="sell"
          disabled={!sellAsset}
          onPress={() => sellAsset && onSell(sellAsset)}
          sheet={sheet}
          color={color}
        />
      </View>
    </View>
  );
}

/**
 * Full wallet balances list with per-balance actions (native port of the web
 * {@link WalletBalances}). BTC is shown large at the top (Deposit / Withdraw);
 * the XCP / KOR / ZELD headline tokens each get a card with
 * Deposit / Withdraw / Sell; and every other holding is a tile with compact icon
 * actions, grouped by kind (Counterparty · Kontor · Ordinals). Consumes the
 * shared {@link useWalletTokenSummary} hook (same data as web).
 */
export function WalletBalances({ title, style, styles: stylesProp }: WalletBalancesProps) {
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const iconColor = theme.colors.text;
  const mutedColor = theme.colors.textMuted;

  const {
    btc,
    btcSats,
    primary,
    isFetching,
    lastFetchedAt,
    refresh,
    usd,
    addresses,
    otherGroups,
    activeGroup,
    activeLabel,
    setOtherTab,
    deposit,
    closeDeposit,
    sellAsset,
    setSellAsset,
    withdraw,
    setWithdraw,
    openDeposit,
    openDepositForAsset,
  } = useWalletBalancesController();

  return (
    <View style={[sheet.root, style, stylesProp?.root]}>
      <View style={[sheet.headerRow, stylesProp?.header]}>
        {title}
        <View style={sheet.headerMeta}>
          <Text style={sheet.updated}>Updated {formatRelativeTime(lastFetchedAt)}</Text>
          <Pressable
            onPress={refresh}
            disabled={isFetching}
            style={[
              sheet.refreshButton,
              isFetching && sheet.disabled,
              stylesProp?.buttonSecondary,
            ]}
          >
            <Text style={sheet.refreshText}>{isFetching ? "Refreshing…" : "Refresh"}</Text>
          </Pressable>
        </View>
      </View>

      {addresses ? (
        <View style={sheet.section}>
          <Text style={sheet.sectionTitle}>Addresses</Text>
          <View style={sheet.addressList}>
            <AddressRow label="Segwit (P2WPKH)" address={addresses.p2wpkh} sheet={sheet} color={iconColor} />
            {addresses.p2tr ? (
              <AddressRow label="Taproot (P2TR)" address={addresses.p2tr} sheet={sheet} color={iconColor} />
            ) : null}
          </View>
        </View>
      ) : null}

      <Text style={sheet.sectionTitle}>Balances</Text>

      <View style={[sheet.btcCard, stylesProp?.btc]}>
        <View style={sheet.balanceInfo}>
          <TokenMark line={btc} size={44} />
          <View style={{ flexShrink: 1 }}>
            <Text>
              <Text style={sheet.btcAmount}>{btc.amount ?? "…"}</Text>{" "}
              <Text style={sheet.btcUnit}>BTC</Text>
            </Text>
            {usd ? <Text style={sheet.btcUsd}>{usd}</Text> : null}
          </View>
        </View>
        <View style={sheet.actionRow}>
          <LabeledAction kind="deposit" onPress={() => openDeposit("BTC", "btc")} sheet={sheet} color={iconColor} />
          <LabeledAction
            kind="withdraw"
            disabled={btcSats === null || btcSats === 0n}
            onPress={() => setWithdraw({ type: "btc", balanceSats: btcSats })}
            sheet={sheet}
            color={iconColor}
          />
        </View>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        {primary.map((line) => (
          <TokenCell
            key={line.symbol}
            line={line}
            onDeposit={openDeposit}
            onWithdraw={setWithdraw}
            onSell={setSellAsset}
            sheet={sheet}
            color={iconColor}
            styleProp={stylesProp?.token}
          />
        ))}
      </View>

      <View style={sheet.section}>
        <View style={[sheet.tabRow, stylesProp?.groupHeader]}>
          {otherGroups.map((group) => {
            const active = group.label === activeLabel;
            return (
              <Pressable
                key={group.label}
                onPress={() => setOtherTab(group.label)}
                style={[sheet.tab, active && sheet.tabActive]}
              >
                <Text style={[sheet.tabText, active && sheet.tabTextActive]}>{group.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {activeGroup.options.length === 0 ? (
          <View style={sheet.emptyOthers}>
            <Text style={sheet.emptyText}>No {activeGroup.label} holdings yet.</Text>
            <LabeledAction
              kind="deposit"
              onPress={() => openDeposit(activeGroup.depositSymbol, activeGroup.depositType)}
              sheet={sheet}
              color={iconColor}
            />
          </View>
        ) : (
          <View style={sheet.tilesWrap}>
            {activeGroup.options.map((a) => (
              <OtherAssetTile
                key={assetKey(a)}
                asset={a}
                onDeposit={openDepositForAsset}
                onWithdraw={setWithdraw}
                onSell={setSellAsset}
                sheet={sheet}
                color={iconColor}
                mutedColor={mutedColor}
                styleProp={stylesProp?.tile}
              />
            ))}
          </View>
        )}
      </View>

      {/* Deposit modal */}
      <Modal
        open={deposit != null}
        onClose={closeDeposit}
        title={deposit ? `Deposit ${deposit.symbol}` : ""}
      >
        {deposit ? (
          <View style={{ gap: theme.spacing.md }}>
            <Text style={sheet.depositHint}>
              Send {deposit.symbol} from your exchange or preferred wallet to your{" "}
              {deposit.label} address below.
            </Text>
            <View>
              <Text style={sheet.depositLabel}>{deposit.label}</Text>
              <View style={sheet.addressBox}>
                <Text style={sheet.addressBoxText} numberOfLines={2}>
                  {deposit.address}
                </Text>
                <CopyButton value={deposit.address} sheet={sheet} color={mutedColor} />
              </View>
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Sell modal */}
      <Modal open={sellAsset != null} onClose={() => setSellAsset(null)} title="Sell">
        {sellAsset ? (
          <SellOrderForm
            key={assetKey(sellAsset)}
            initialAsset={sellAsset}
            onClose={() => setSellAsset(null)}
          />
        ) : null}
      </Modal>

      {/* Withdraw modal */}
      <Modal
        open={withdraw != null}
        onClose={() => setWithdraw(null)}
        title={withdraw ? `Withdraw ${withdrawTitle(withdraw)}` : ""}
      >
        {withdraw ? (
          <WithdrawForm
            key={withdrawKey(withdraw)}
            target={withdraw}
            onClose={() => setWithdraw(null)}
          />
        ) : null}
      </Modal>
    </View>
  );
}
