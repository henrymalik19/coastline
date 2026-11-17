import { Text, type ViewStyle } from "react-native";
import { space, type, useTheme } from "../lib/theme";
import { Button } from "./form";
import { Card } from "./ui";

/** Shown instead of the Coast FI result while the plan has no retirement spending, so there's no number to work out yet. */
export function NeedsBudget({ onPress, style }: { onPress: () => void; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <Card style={{ gap: space.md, ...style }}>
      <Text style={[type.heading, { color: t.text }]}>Add your budget to see your number</Text>
      <Text style={[type.body, { color: t.text2 }]}>
        Your Coast FI number comes from what you'll spend once you retire. Add your monthly costs, even rough ones, and mark which ones you'll still pay after
        you retire.
      </Text>
      <Button title="Add my budget" tone="primary" style={{ alignSelf: "flex-start" }} onPress={onPress} />
    </Card>
  );
}
