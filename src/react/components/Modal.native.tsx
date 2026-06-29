import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";

export interface ModalProps {
  /** Whether the modal is visible. When false, nothing is rendered. */
  open: boolean;
  /** Called when the backdrop is tapped, the ✕ is pressed, or back is hit. */
  onClose: () => void;
  /** Heading shown on the left of the title row, beside the close button. */
  title?: ReactNode;
  /** Max card width in px. Defaults to 450 (matches Horizon Market). */
  maxWidth?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const MODAL_PADDING = 24;

function createSheet(theme: ResolvedTheme, maxWidth: number) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.7)",
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing.md,
    },
    // Card is the visible surface: solid elevated fill (the lighter stop of the
    // web's diagonal gradient), no border, generous padding, large radius.
    card: {
      width: "100%",
      maxWidth,
      maxHeight: "90%",
      backgroundColor: theme.colors.backgroundElevated,
      borderRadius: theme.radii.lg,
      padding: MODAL_PADDING,
      gap: theme.spacing.lg,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.md,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
      color: theme.colors.text,
    },
    // ScrollView must be allowed to shrink within the card's maxHeight — RN's
    // default flexShrink is 0, which would clip tall content instead of
    // scrolling it. Short content still sizes to its content (no flexGrow).
    body: {
      flexShrink: 1,
    },
    close: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    closeText: {
      fontSize: theme.typography.fontSizeLg,
      lineHeight: theme.typography.fontSizeLg + 2,
      color: theme.colors.text,
    },
  });
}

/**
 * Shared overlay modal for native, mirroring the web {@link Modal}: a dimmed
 * backdrop with a centered card (solid elevated fill, no border, generous
 * padding, large radius) and a title row carrying the heading on the left and a
 * ✕ on the right. Body content scrolls when it exceeds the card height. The
 * panel content is chrome-less and stacks directly under the title row.
 */
export function Modal({
  open,
  onClose,
  title,
  maxWidth = 450,
  children,
  style,
}: ModalProps) {
  const theme = useTheme();
  const sheet = useMemo(
    () => createSheet(theme, maxWidth),
    [theme, maxWidth],
  );

  return (
    <RNModal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={sheet.overlay} onPress={onClose}>
        {/* Stop taps on the card from bubbling to the dismiss-on-backdrop press. */}
        <Pressable style={[sheet.card, style]} onPress={() => {}}>
          <View style={sheet.header}>
            {title != null ? (
              <Text style={sheet.title}>{title}</Text>
            ) : (
              <View />
            )}
            <Pressable
              onPress={onClose}
              style={sheet.close}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Text style={sheet.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={sheet.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}
