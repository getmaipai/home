// FOLLOWUP-01 (hub half): the roster a paired robot's PeopleDirectory is filled from. Exactly what the robot
// decides with and nothing more: a person id, the age band and whether the follow-up window may open for
// them. No name, no birthdate, no setting a robot does not act on. Only people the robot could recognise
// (a live, robot-eligible face print) are listed, the same set the print sync serves, so a person who is not
// enrolled never appears and a revoked print drops its person on the next poll.
//
// The follow-up switch is the effective one, decided here so the robot has no rule of its own to get wrong:
// an adult or teen follows `person.robot.follow_up` (default on); a child is on only when the key was saved
// as true by someone else (settings.ts refuses a child's own write), and a missing row is off.
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { listRobotKnownPersonIds } from "@/lib/biometricPrints";
import { ROBOT_FOLLOW_UP_KEY, getPersonSettingSource, getSettingValueForPerson } from "@/lib/settings";

export interface RobotPersonEntry {
  person_id: string;
  age_band: AgeBand;
  follow_up: boolean;
}

export function followUpAllowed(personId: string, band: AgeBand): boolean {
  const value = getSettingValueForPerson(personId, ROBOT_FOLLOW_UP_KEY);
  if (band === "child") return value === true && getPersonSettingSource(personId, ROBOT_FOLLOW_UP_KEY) === "user";
  return value !== false;
}

export function listRobotPeople(now: Date = new Date()): RobotPersonEntry[] {
  const ids = listRobotKnownPersonIds();
  if (ids.length === 0) return [];
  return db.select().from(people).where(inArray(people.id, ids)).all()
    .map((person) => {
      const age_band = speakerAgeBand(person, now);
      return { person_id: person.id, age_band, follow_up: followUpAllowed(person.id, age_band) };
    })
    .sort((a, b) => a.person_id.localeCompare(b.person_id));
}
