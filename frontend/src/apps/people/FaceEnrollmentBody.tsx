import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, type BiometricPrintSummary, type PersonRosterEntry, type Roster } from "@/lib/api";
import { canManagePerson } from "@/apps/people/roles";
import { canEnrollFace } from "@/apps/people/faceEnrollmentGate";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { formatDate } from "@/lib/format";

type Profile = PersonRosterEntry | Roster;
/** True when the viewer may see this person's face-recognition status. The caller draws the Card only when this holds. */
export function canViewFaceEnrollment(viewer: Roster, profile: Profile): boolean {
  return canManagePerson(viewer.role, viewer.id, { id: profile.id, role: profile.role });
}

/** The inside of the face-recognition Card (header and content); the page renders the kit Card around it. */
export function FaceEnrollmentBody({ viewer, profile, viewingSelf = viewer.id === profile.id }: { viewer: Roster; profile: Profile; viewingSelf?: boolean }) {
  const target = { id: profile.id, role: profile.role };
  const canView = canManagePerson(viewer.role, viewer.id, target);
  const canEnroll = canEnrollFace(viewer, target);
  const query = useQuery<BiometricPrintSummary[]>({ queryKey: ["biometric-prints", profile.id], queryFn: () => api.biometricPrints(profile.id), enabled: canView });
  if (!canView) return null;
  return <>
    <CardHeader><CardTitle>{i18n._({ id: "Face recognition", message: "Face recognition" })}</CardTitle><CardDescription>{i18n._({ id: "MaiPai uses this to recognise you when you are in front of the camera. It stays on your home hub.", message: "MaiPai uses this to recognise you when you are in front of the camera. It stays on your home hub." })}</CardDescription></CardHeader>
    <CardContent>
      <div className="flex flex-col gap-4">
      <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage={i18n._({ id: "Could not load setup status.", message: "Could not load setup status." })} loadingLabel={i18n._({ id: "Loading setup status", message: "Loading setup status" })}>
        {(prints) => {
          const faces = prints.filter((print) => print.modality === "face" && print.deleted_at === null).sort((a, b) => b.created_at.localeCompare(a.created_at));
          const label = faces.length ? i18n._({ id: "Set up on {date}", message: "Set up on {date}", values: { date: formatDate(faces[0]!.created_at, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) } }) : i18n._({ id: "Not set up yet", message: "Not set up yet" });
          return <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{label}</p>{canEnroll ? <Link className="inline-flex min-h-12 items-center justify-center rounded-[var(--radius)] border border-border px-4 text-sm font-medium" to={`/people/${profile.id}/enroll-face`}>{faces.length ? i18n._({ id: "Re-enroll", message: "Re-enroll" }) : i18n._({ id: "Enroll", message: "Enroll" })}</Link> : viewingSelf && profile.role === "child" ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Ask an admin to set this up.", message: "Ask an admin to set this up." })}</p> : null}</div>;
        }}
      </AsyncState>
      {canEnroll ? <SettingsRenderer scope="person" scopeValue={`person:${profile.id}`} only={["person.profile"]} includeKeys={["ui.enrollment_sounds"]} plainRows /> : null}
      </div>
    </CardContent>
  </>;
}
