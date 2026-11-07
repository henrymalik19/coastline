import { SectionPage } from "../../../components/settings/SectionPages";

/** Settings pages. "Your money" pages also open here, so older /settings/budget links keep working. */
export default function SettingsSection() {
  return <SectionPage base="/settings" />;
}
