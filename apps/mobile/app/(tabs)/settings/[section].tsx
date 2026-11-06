import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { Screen } from "../../../components/ui";
import { SECTION_SCREENS, findSection } from "../../../components/settings/sections";
import { useTheme } from "../../../lib/theme";

const FULL_PAGE = new Set(["income", "budget"]);

export default function SettingsSection() {
  const t = useTheme();
  const { section } = useLocalSearchParams<{ section: string }>();
  const meta = findSection(section);
  const Body = meta ? SECTION_SCREENS[meta.key] : undefined;
  return (
    // income and budget are two-pane editors: full width & height, scrolling inside their panes
    <Screen
      title={meta?.title ?? "Not found"}
      subtitle={meta?.subtitle}
      narrow={!(meta && FULL_PAGE.has(meta.key))}
      fill={!!meta && FULL_PAGE.has(meta.key)}
      back
      hideSettings
    >
      {Body ? <Body /> : <Text style={{ color: t.text2 }}>That settings page doesn't exist.</Text>}
    </Screen>
  );
}
