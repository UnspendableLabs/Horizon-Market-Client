import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { Addresses } from "../context.js";
import { useLoginPanel } from "../hooks/useLoginPanel.js";
import { useTheme } from "../hooks/useTheme.js";
import { MONO_FONT, useCommonSheet } from "../internal/styles.native.js";
import type { ResolvedTheme } from "../theme.js";

export interface LoginPanelStyles {
  root?: StyleProp<ViewStyle>;
  label?: StyleProp<TextStyle>;
  input?: StyleProp<TextStyle>;
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
  status?: StyleProp<TextStyle>;
  address?: StyleProp<TextStyle>;
  error?: StyleProp<TextStyle>;
}

export interface LoginPanelProps {
  getPrivateKey: (email: string) => Promise<string>;
  autoDetectSession?: boolean;
  emailLabel?: string;
  connectLabel?: string;
  onSuccess?: (addresses: Addresses) => void;
  onError?: (error: Error) => void;
  style?: StyleProp<ViewStyle>;
  styles?: LoginPanelStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    root: { maxWidth: 420 },
    status: { color: theme.colors.success, fontWeight: "600" },
    address: {
      fontFamily: MONO_FONT,
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
    },
  });
}

export function LoginPanel({
  getPrivateKey,
  autoDetectSession = true,
  emailLabel = "Email",
  connectLabel = "Connect with Web3Auth",
  onSuccess,
  onError,
  style,
  styles: stylesProp,
}: LoginPanelProps) {
  const theme = useTheme();
  const common = useCommonSheet();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const { email, setEmail, phase, error, addresses, connect } = useLoginPanel({
    getPrivateKey,
    autoDetectSession,
    onSuccess,
    onError,
  });

  const root = [common.root, sheet.root, style, stylesProp?.root];

  if (phase === "success" && addresses) {
    return (
      <View style={root}>
        <Text style={[sheet.status, stylesProp?.status]}>✅ Connected</Text>
        <Text style={[sheet.address, stylesProp?.address]}>
          {addresses.p2wpkh}
        </Text>
        {addresses.p2tr && (
          <Text style={[sheet.address, stylesProp?.address]}>
            {addresses.p2tr}
          </Text>
        )}
      </View>
    );
  }

  const disabled = phase === "verifying" || !email;

  return (
    <View style={root}>
      <View>
        <Text style={[common.label, stylesProp?.label]}>{emailLabel}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          editable={phase !== "verifying"}
          placeholder="you@example.com"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={[common.input, stylesProp?.input]}
        />
      </View>
      <Pressable
        disabled={disabled}
        onPress={connect}
        style={[
          common.button,
          disabled && common.buttonDisabled,
          stylesProp?.button,
        ]}
      >
        {phase === "verifying" ? (
          <ActivityIndicator color={theme.colors.primaryForeground} />
        ) : (
          <Text style={[common.buttonText, stylesProp?.buttonText]}>
            {connectLabel}
          </Text>
        )}
      </Pressable>
      {phase === "error" && error && (
        <Text style={[common.error, stylesProp?.error]}>✗ {error.message}</Text>
      )}
    </View>
  );
}
