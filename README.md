# Family Tree

A family tree website with an Express API and a plain JSON file as the database.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. Requires Node.js 18 or newer.

`npm run dev` restarts the server when you edit code. `npm run reset` restores the sample Hartwell family.
To start with an empty tree, replace `data/db.json` with `{ "meta": { "name": "My Family" }, "people": [] }`.

## Using the site

- Click any person to make them the focus. The tree glides to re-center on them, showing four generations of
  ancestors above and four generations of descendants below, with siblings to the left and partners to the right.
- Aunts and uncles (with their partners) appear on the parents' row: the father's side to the left, the mother's
  side to the right. First cousins (with their partners) appear on the focus person's row, under their own parents,
  and cousins' children appear on the row below them.
- Siblings appear with their partners, and their children (nieces and nephews) appear below them.
- When someone has children with more than one partner, the partners sit on either side of them and each set of
  children connects only to its own two parents. Half-siblings connect only to the parent they share. A dashed
  line between partners means they divorced.
- Click the focus person again (or use the side panel on desktop) to see their profile, life events and family.
- Dashed "+ Parent / Partner / Child / Sibling" buttons appear around the focus card for relatives not added yet.
  The "Add a relative" buttons in the profile always work.
- "Link existing relative" connects two people who are already in the tree.
- Hover a relative in the profile to edit marriage details or remove the link.
- Drag to pan, scroll or pinch to zoom, arrow keys move between relatives. Small triangles on a card mean there are
  more ancestors or descendants beyond the current view.
- Click the tree name in the top-left corner to rename it.

## The JSON database (`data/db.json`)

The file is re-read on every request, so you can edit it by hand while the server runs. Writes are saved atomically.

```jsonc
{
  "meta": { "name": "The Hartwell Family", "rootPersonId": "p_daniel" },
  "people": [
    {
      "id": "p_daniel",
      "firstName": "Daniel", "middleName": "", "lastName": "Hartwell", "maidenName": "", "nickname": "",
      "gender": "male",                      // male | female | other | unknown
      "birth": { "date": "1984-02-19", "place": "Hartford, Connecticut" },
      "death": null,                         // or { "date": "...", "place": "..." }
      "living": true,
      "photo": "",                           // image URL or data: URL
      "bio": "",
      "parents": ["p_robert", "p_ada"],      // up to two ids
      "spouses": [
        { "id": "p_sofia", "marriageDate": "2012-07-07", "marriagePlace": "Uppsala, Sweden", "divorceDate": null, "status": "married" }
      ],
      "events": [
        { "id": "e_1", "type": "Occupation", "date": "2010", "endDate": null, "place": "Seattle", "note": "Architect" }
      ]
    }
  ]
}
```

Rules worth knowing when editing by hand:

- When editing the file by hand, write dates as `YYYY-MM-DD`, `YYYY-MM` or `YYYY` (for example `1948-05-12`).
  This is the stored form that keeps dates sorting correctly. The website and API accept friendlier forms
  like `12 May 1948` and convert them for you.
- Children are never stored. They are worked out from everyone's `parents` list, so adding a parent id is all it takes.
- Partnerships are stored on both people. If you add one by hand, add the matching entry to the other person too.

## API

All bodies are JSON. Errors come back as `{ "error": "message" }` with a 4xx status.

| Method | Route | What it does |
| --- | --- | --- |
| GET | `/api/tree` | Everything: meta and all people (with derived `children`) |
| PUT | `/api/meta` | Update `name` or `rootPersonId` (the home person) |
| GET | `/api/people?q=smith` | List people, optional name search |
| GET | `/api/people/:id` | One person |
| POST | `/api/people` | Create a person. Optional `parents`, `children`, `spouses` arrays link them right away |
| PUT | `/api/people/:id` | Update profile fields and `events` |
| DELETE | `/api/people/:id` | Delete a person and all links to them |
| POST | `/api/people/:id/parents` | `{ "parentId" }` |
| DELETE | `/api/people/:id/parents/:parentId` | Unlink a parent |
| POST | `/api/people/:id/children` | `{ "childId" }` |
| DELETE | `/api/people/:id/children/:childId` | Unlink a child |
| POST | `/api/people/:id/spouses` | `{ "spouseId", "marriageDate", "marriagePlace", "divorceDate" }` |
| PUT | `/api/people/:id/spouses/:spouseId` | Update marriage details |
| DELETE | `/api/people/:id/spouses/:spouseId` | Unlink partners |
| POST | `/api/people/:id/events` | `{ "type", "date", "endDate", "place", "note" }` |
| PUT | `/api/people/:id/events/:eventId` | Update an event |
| DELETE | `/api/people/:id/events/:eventId` | Delete an event |
| GET | `/api/export` | Download a backup of the database |

Dates can be sent in any of these forms, and are always stored and returned as `YYYY-MM-DD`, `YYYY-MM` or `YYYY`:
`12 May 1948`, `12th May, 1948`, `12-May-1948`, `May 12 1948`, `May 12, 1948`, `May 1948`, `1948`, `1948-05-12`.
Month names can be full or short (`Sep`, `Sept.`, `September`). All-number dates like `12/05/1948` are refused
because they mean different things in different countries. Impossible dates like `31 Apr 1950` are refused too.

The API refuses links that don't make sense: more than two parents, being your own parent or partner,
or a loop where someone becomes their own ancestor.

Example:

```bash
curl -X POST localhost:3000/api/people -H 'Content-Type: application/json' \
  -d '{"firstName":"Ivy","lastName":"Hartwell","gender":"female","birth":{"date":"1 April 2020"},"parents":["p_daniel","p_sofia"]}'
```

Set the `PORT` or `DB_PATH` environment variables to change the port or database location.
