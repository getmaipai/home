# What each role can do (/docs/user/your-family/what-each-role-can-do)

{/* generated-source: backend/src/lib/access.ts and frontend/src/apps/people/roles.ts */}

Every person has one role. It sets what they can do.

| Role | Sign-in | Can add people | Can see a child's profile | Temporary chats |
|---|---|---|---|---|
| **Owner** | PIN or password | Anyone, including admins | Yes | Yes |
| **Admin** | PIN or password | Adults, teens, children, guests | Yes | Yes |
| **Adult** | PIN or password | No | No | Yes |
| **Teen** | None needed | No | No | No |
| **Child** | None needed | No | No | No |
| **Guest** | None needed | No | No | No |

## 🔐 Private by design [#-private-by-design]

- Everyone can open their own profile and memories.
- An owner or admin can open a **child's** profile and memories. They cannot open a teen's or another adult's.
- A teen's chats and settings stay private from admins.

## 👶 Children [#-children]

Children's answers follow stricter settings. Only an owner or admin can change them. See [Sensitive subjects](/docs/user/your-family/sensitive-subjects).

## 🙋 Still need help? [#-still-need-help]

To change someone's role, ask an admin. Admins, see [People, roles and permissions](/docs/admin/how-it-works/people-roles-and-permissions).
