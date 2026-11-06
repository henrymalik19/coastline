import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { Screen } from "../../../components/ui";
import { SECTION_SCREENS, findSection } from "../../../components/settings/sections";
import { useTheme } from "../../../lib/theme";

export default function SettingsSection() {
  const t = useTheme();
  const { section } = useLocalSearchParams<{ section: string }>();
  const meta = findSection(section);
  const Body = meta ? SECTION_SCREENS[meta.key] : undefined;
  return (
    <Screen title={meta?.title ?? "Not found"} subtitle={meta?.subtitle} narrow back hideSettings>
      {Body ? <Body /> : <Text style={{ color: t.text2 }}>That settings page doesn't exist.</Text>}
    </Screen>
  );
}
