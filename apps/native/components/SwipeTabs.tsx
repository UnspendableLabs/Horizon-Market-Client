import type { ParamListBase, TabNavigationState } from "@react-navigation/native";
import type {
  MaterialTopTabNavigationEventMap,
  MaterialTopTabNavigationOptions,
} from "@react-navigation/material-top-tabs";
// SDK 56+: Expo Router no longer allows importing the navigator *runtime* from the
// external `@react-navigation/material-top-tabs` package — Metro fails the bundle
// (it must use Router's vendored copy to avoid a duplicate React Navigation
// instance). Take the `createMaterialTopTabNavigator` value from
// `expo-router/js-top-tabs`; the option/event *types* above are `import type`
// (erased at bundle time, so they don't trip the check) and keep the real,
// fully-typed definitions rather than Router's `any`-typed vendored copies.
import { createMaterialTopTabNavigator } from "expo-router/js-top-tabs";
import { withLayoutContext } from "expo-router";

/**
 * An expo-router-flavoured Material top-tab navigator, positioned at the bottom.
 *
 * The app's tab group used to be a `<Tabs>` (bottom-tabs) navigator: it renders a
 * bottom bar but has NO swipe — switching tabs is tap-only. Material top-tabs is
 * the one built-in React Navigation navigator whose scenes live inside a native
 * pager (`react-native-pager-view`), so it swipes horizontally between screens.
 * Pinning its bar to the bottom (`tabBarPosition="bottom"`) + feeding it our
 * existing custom {@link TabBar} keeps the exact same classic bottom-tab look while
 * adding the left/right swipe gesture on top.
 *
 * `withLayoutContext` is expo-router's adapter that lets a stock React Navigation
 * navigator be driven by the file-based routes under `app/(tabs)/` — so the screen
 * files and `<SwipeTabs.Screen>` declarations work exactly as they did under
 * `<Tabs>`. The generics wire up the Material-top-tab option/event types so screen
 * options (e.g. `swipeEnabled`) stay type-checked.
 */
const { Navigator } = createMaterialTopTabNavigator();

export const SwipeTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(Navigator);
