import type { ParamListBase, TabNavigationState } from "@react-navigation/native";
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabNavigationEventMap,
  type MaterialTopTabNavigationOptions,
} from "@react-navigation/material-top-tabs";
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
