import { useQuery } from "@tanstack/react-query";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@maipai/ui/src/dashboard/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type Roster, type SkillRow } from "@/lib/api";

// SKILLS-PAGE-01 (owner, 2026-10-06): the Skills section of Chat settings.
// A skill is an installed package the assistant can use in chat: a plugin
// (a tool the model can call), a skill (plain instructions) or a project
// type. Every state here is read from the hub (GET /api/plugins/skills):
// `used_in_chat` is the same offered set this person's written chat turn
// builds. Nothing switches a skill on or off yet: nothing in the turn reads
// such a switch (THIN-2F builds it).
//
// A plain data component with no layout of its own (no page title, frame or
// width), so the per-app settings shell (APP-SETTINGS-DESIGN) places it.
// A child has no Skills section: the caller does not render it for a child,
// and it renders nothing for one either.

const SkillIcon = getIcon("puzzle");
const AddedIcon = getIcon("package");

/** In chat first, then by name. */
function bySkillOrder(a: SkillRow, b: SkillRow): number {
  return Number(b.used_in_chat) - Number(a.used_in_chat) || a.name.localeCompare(b.name);
}

/** One skill's row: its name, what it does, and whether chat uses it. */
function skillRow(skill: SkillRow, minor: boolean) {
  return (
    <Item key={skill.id} size="sm" data-skill-id={skill.id}>
      <ItemMedia variant="icon">
        <SkillIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{skill.name}</ItemTitle>
        <ItemDescription>{skill.description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        {skill.offer_label ? (
          <Badge variant="outline">{skill.offer_label}</Badge>
        ) : skill.used_in_chat ? (
          <Badge variant="secondary">Used in chat</Badge>
        ) : (
          <Badge variant="outline">{minor ? "Not used in your chats" : "Not used in chat yet"}</Badge>
        )}
      </ItemActions>
    </Item>
  );
}

export function ChatSkillsSection({ person }: { person: Roster }) {
  const isChild = person.role === "child";
  const minor = isChild || person.role === "teen";
  const skillsQuery = useQuery({ queryKey: ["skills"], queryFn: () => api.skills(), enabled: !isChild });
  if (isChild) return null;
  if (skillsQuery.isLoading) return <p role="status" className="text-muted-foreground text-sm">Loading skills</p>;
  if (skillsQuery.isError) return <p role="alert" className="text-destructive text-sm">Could not load skills. Try again in a moment.</p>;

  const skills = skillsQuery.data ?? [];
  const included = skills.filter((skill) => skill.origin === "bundled").sort(bySkillOrder);
  const added = skills.filter((skill) => skill.origin === "store").sort(bySkillOrder);
  return (
    <>
      <h3 className="text-sm font-medium">Included</h3>
      <ItemGroup aria-label="Included skills">{included.map((skill) => skillRow(skill, minor))}</ItemGroup>
      <h3 className="text-sm font-medium">Added to this home</h3>
      {added.length > 0 ? (
        <ItemGroup aria-label="Skills added to this home">{added.map((skill) => skillRow(skill, minor))}</ItemGroup>
      ) : (
        <Empty data-skills="added-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AddedIcon />
            </EmptyMedia>
            <EmptyTitle>No skills added yet</EmptyTitle>
            <EmptyDescription>
              Skills added from the MaiPai Catalog will show up here. Adding them from here, and writing your own, is not built yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  );
}
