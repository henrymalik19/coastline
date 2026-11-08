import { SectionPage } from "../../../components/settings/SectionPages";

/** Settings pages. "Your money" pages also open here, so older /settings/income links keep working (the Money tab has its own). */
export default function SettingsSection() {
  return <SectionPage base="/settings" />;
}
