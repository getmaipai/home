# People, roles and permissions (/docs/admin/how-it-works/people-roles-and-permissions)

{/* generated-source: frontend/src/apps/people/roles.ts, backend/src/lib/access.ts, backend/src/lib/personLifecycle.ts, shared/personCredentialRoles.ts */}

Every person in Home has one role. The role decides what they can open, change and see.

<Shot id="roles-users" />

## 🪜 The six roles [#-the-six-roles]

From most to least control: **owner**, **admin**, **adult**, **teen**, **child**, **guest**.

| Role | Sign-in | Runs the house | Reads others' private data |
|---|---|---|---|
| Owner | PIN or password | Everything, including restore | Own, plus a child's |
| Admin | PIN or password | Settings, people, backups, updates | Own, plus a child's |
| Adult | PIN or password | No | Own only |
| Teen | None required | No | Own only |
| Child | None required | No | Own only; a parent sees it |
| Guest | None required | No | None |

## 🔑 What only the owner can do [#-what-only-the-owner-can-do]

- Create another owner or an admin. An admin can add adults, teens, children and guests.
- Change a person's role. Nobody can change their own role.
- Restore a backup. An admin can see the backup list and run one.

Home refuses to remove or demote the household's only owner. Make someone else an owner first.

## 🛡️ What admins cannot see [#️-what-admins-cannot-see]

An owner or admin can open a **child's** profile, memories and settings. A **teen's** profile does not open at all for them, from Family or by typing its address. They cannot see another adult's memories or settings. A teen's chats and settings stay private from admins. This is built in and has no switch.

Household-wide switches still apply to every teen, such as **Web search with teen controls** under Settings, Search. Those change what Home does for teens as a group. They never show an admin what a teen asked.

## 🔒 Settings that follow the role [#-settings-that-follow-the-role]

- **Household settings** are writable only by an owner or admin.
- **Session lock** (ask for the PIN again after idle time) is set by an owner or admin, from the people list in Settings, Users.
- A child's **Sensitive subjects** levels are set only by an owner or admin. The child cannot change them.
- Each person's own look, voice and notification settings belong to that person.

## 🧪 Check it yourself [#-check-it-yourself]

1. Open **Family** as the admin.
2. Open a child's card. You see **Overview**, **Memories**, **Limits** and **Topics**.
3. Look at a teen's card in **Family**. It is not a link, and a typed address shows a "You cannot open this profile" message, so there is no **Limits**, **Topics** or **Memories** tab and no teen chats or memories are shown.

For what each role sees day to day, see [What each role can do](/docs/user/your-family/what-each-role-can-do).
