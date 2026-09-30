import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { api, type BiometricPrintSummary, type PersonRosterEntry, type Roster } from "@/lib/api";
import { canManagePerson } from "@/apps/people/roles";
import { canEnrollFace } from "@/apps/people/faceEnrollmentGate";
import { NextSettingsRenderer } from "@/next/pages/settings/NextSettingsRenderer";

type Profile = PersonRosterEntry | Roster;
export function FaceEnrollmentCard({ viewer, profile, viewingSelf = viewer.id === profile.id }: { viewer: Roster; profile: Profile; viewingSelf?: boolean }) {
  const target = { id: profile.id, role: profile.role };
  const canView = canManagePerson(viewer.role, viewer.id, target);
  const canEnroll = canEnrollFace(viewer, target);
  const query = useQuery<BiometricPrintSummary[]>({ queryKey: ["biometric-prints", profile.id], queryFn: () => api.biometricPrints(profile.id), enabled: canView });
  if (!canView) return null;
  return <Card>
    <CardHeader><CardTitle>Face recognition</CardTitle><CardDescription>MaiPai uses this to recognise you when you are in front of the camera. It stays on your home hub.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage="Could not load setup status." loadingLabel="Loading setup status">
        {(prints) => {
          const faces = prints.filter((print) => print.modality === "face" && print.deleted_at === null).sort((a, b) => b.created_at.localeCompare(a.created_at));
          const label = faces.length ? `Set up on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(faces[0]!.created_at))}` : "Not set up yet";
          return <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{label}</p>{canEnroll ? <Link to={`/people/${profile.id}/enroll-face`}><Button type="button" variant="outline" className="min-h-12">{faces.length ? "Re-enroll" : "Enroll"}</Button></Link> : viewingSelf && profile.role === "child" ? <p className="text-sm text-muted-foreground">Ask an admin to set this up.</p> : null}</div>;
        }}
      </AsyncState>
      {canEnroll ? <NextSettingsRenderer scope="person" scopeValue={`person:${profile.id}`} only={["profile.appearance"]} includeKeys={["ui.enrollment_sounds"]} plainRows /> : null}
    </CardContent>
  </Card>;
}
