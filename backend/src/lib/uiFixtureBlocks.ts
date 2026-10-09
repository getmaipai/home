import type { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";

// GENUI-03b: one answer block of each v1 kind, for the /dev/ui showcase. The
// shapes follow the spec's own valid fixtures (spec/fixtures/answer-block/);
// the gallery's pictures are the hub's own brand icons so they paint, and
// every block is stamped as the showcase's. The test proves each one parses
// as an AnswerBlock, so a spec change that breaks one fails here.
const STAMP = { created_at: "2026-10-08T14:03:11Z", hlc: "1791468191000:0:hub001" } as const;

const BLOCK_SPEC_SHEET: AnswerBlock = {
  "id": "blk-a1b2c3",
  "kind": "spec_sheet",
  "schema_version": 1,
  "producer": "products",
  "alt": "Pixel 9 specifications: 6.3 inch display, 12 GB memory, 4700 mAh battery.",
  "provenance": "products call turn-k3m9x2:call0",
  "props": {
    "title": "Pixel 9",
    "subtitle": "Phone",
    "rows": [
      {
        "label": "Display",
        "value": "6.3 in OLED",
        "emphasis": true
      },
      {
        "label": "Memory",
        "value": "12 GB"
      },
      {
        "label": "Battery",
        "value": "4700 mAh"
      }
    ]
  },
  ...STAMP,
};

const BLOCK_DATA_TABLE: AnswerBlock = {
  "id": "blk-d4e5f6",
  "kind": "data_table",
  "schema_version": 1,
  "producer": "recipes",
  "alt": "Three dishes with prep time and cost; the lasagne costs the most.",
  "provenance": "recipes call turn-k3m9x2:call0",
  "props": {
    "columns": [
      {
        "id": "dish",
        "header": "Dish",
        "sortable": true
      },
      {
        "id": "minutes",
        "header": "Prep",
        "align": "end",
        "format": {
          "kind": "number",
          "unit": "min"
        }
      },
      {
        "id": "cost",
        "header": "Cost",
        "align": "end",
        "format": {
          "kind": "currency",
          "currency": "USD",
          "decimals": 2
        }
      },
      {
        "id": "vegetarian",
        "header": "Veg",
        "format": {
          "kind": "boolean",
          "trueLabel": "Yes",
          "falseLabel": "No"
        }
      }
    ],
    "rows": [
      {
        "dish": "Lasagne",
        "minutes": 75,
        "cost": 14.5,
        "vegetarian": false
      },
      {
        "dish": "Chana masala",
        "minutes": 40,
        "cost": 6.25,
        "vegetarian": true
      },
      {
        "dish": "Shakshuka",
        "minutes": 25,
        "cost": 5,
        "vegetarian": true
      }
    ],
    "caption": "Dinner options",
    "sort": {
      "columnId": "minutes",
      "direction": "asc"
    },
    "emptyLabel": "No dishes",
    "locale": "en-US"
  },
  ...STAMP,
};

const BLOCK_CHART: AnswerBlock = {
  "id": "blk-c7d8e9",
  "kind": "chart",
  "schema_version": 1,
  "producer": "energy",
  "alt": "Electricity use fell 8 percent over the last seven days.",
  "provenance": "energy call turn-k3m9x2:call0",
  "props": {
    "label": "Electricity, kWh per day",
    "value": "12.4 kWh",
    "delta": "-8%",
    "points": [
      14,
      13.2,
      13.8,
      12.9,
      12.6,
      12.1,
      12.4
    ],
    "variant": "area",
    "trend": "down",
    "upIsGood": false
  },
  ...STAMP,
};

const BLOCK_TIMELINE: AnswerBlock = {
  "id": "blk-t1m2e3",
  "kind": "timeline",
  "schema_version": 1,
  "producer": "parcels",
  "alt": "The parcel left the depot at 9 am and is due this afternoon.",
  "provenance": "parcels call turn-k3m9x2:call0",
  "props": {
    "events": [
      {
        "id": "e1",
        "when": "past",
        "time": "Mon 9:00",
        "title": "Left the depot",
        "detail": "Leeds"
      },
      {
        "id": "e2",
        "when": "now",
        "time": "Tue 11:30",
        "title": "Out for delivery"
      },
      {
        "id": "e3",
        "when": "future",
        "time": "Tue 15:00",
        "title": "Due at the door"
      }
    ]
  },
  ...STAMP,
};

const BLOCK_TODO_LIST: AnswerBlock = {
  "id": "blk-l5s6t7",
  "kind": "todo_list",
  "schema_version": 1,
  "producer": "lists",
  "alt": "Packing list: two of four items are done.",
  "provenance": "lists call turn-k3m9x2:call0",
  "props": {
    "items": [
      {
        "id": "i1",
        "text": "Passports",
        "status": "done"
      },
      {
        "id": "i2",
        "text": "Chargers",
        "status": "active",
        "description": "Phone, tablet, watch"
      },
      {
        "id": "i3",
        "text": "Book taxi",
        "status": "failed",
        "reason": "No cars at 5 am"
      },
      {
        "id": "i4",
        "text": "Lock windows",
        "status": "pending"
      }
    ],
    "title": "Before we leave",
    "description": "Flight is at 8 am",
    "maxVisible": 8
  },
  ...STAMP,
};

const BLOCK_IMAGE_GALLERY: AnswerBlock = {
  "id": "blk-g8h9i0",
  "kind": "image_gallery",
  "schema_version": 1,
  "producer": "images",
  "alt": "Two photos of the Golden Gate Bridge at sunset.",
  "provenance": "images call turn-k3m9x2:call0",
  "props": {
    "images": [
      {
        "id": "p1",
        "src": "/brand/maipai-home-icon-light.png",
        "alt": "The bridge glowing orange at sunset",
        "caption": "Seen from Marin",
        "source": {
          "label": "Wikimedia Commons",
          "url": "https://commons.wikimedia.org/wiki/File:Golden_Gate.jpg"
        }
      },
      {
        "id": "p2",
        "src": "/brand/pwa-icon-512.png",
        "alt": "Fog rolling under the bridge"
      }
    ],
    "maxVisible": 4
  },
  "min_band": "child",
  ...STAMP,
};

const BLOCK_SCHEDULE_CARD: AnswerBlock = {
  "id": "blk-s2c3h4",
  "kind": "schedule_card",
  "schema_version": 1,
  "producer": "scheduler",
  "alt": "The weekly backup runs every Sunday at 2 am and last ran fine.",
  "provenance": "scheduler call turn-k3m9x2:call0",
  "props": {
    "name": "Weekly backup",
    "cadence": "Every Sunday at 2:00",
    "nextRun": "Sun 2:00",
    "enabled": true,
    "history": [
      {
        "id": "r1",
        "at": "Sun 2:00",
        "ok": true
      },
      {
        "id": "r2",
        "at": "Sun 2:00",
        "ok": false
      }
    ]
  },
  "min_band": "teen",
  ...STAMP,
};

const BLOCK_COMPARISON: AnswerBlock = {
  "id": "blk-k4m5p6",
  "kind": "comparison",
  "schema_version": 1,
  "producer": "shopping",
  "alt": "Of the two vacuums, the Stick fits small flats and the Upright suits big carpets; the Stick is the pick.",
  "provenance": "shopping call turn-k3m9x2:call0",
  "props": {
    "traitLabels": [
      "Cordless",
      "Pet hair",
      "Runtime"
    ],
    "options": [
      {
        "id": "o1",
        "name": "Stick",
        "headline": "$199",
        "traits": [
          "Yes",
          "Good",
          "40 min"
        ]
      },
      {
        "id": "o2",
        "name": "Upright",
        "headline": "$279",
        "traits": [
          false,
          "Best",
          "Mains"
        ]
      }
    ],
    "recommendedId": "o1",
    "reason": "Smaller home, mostly floors."
  },
  ...STAMP,
};

/** One block of each v1 kind, in a fixed order. */
export const SHOWCASE_BLOCKS: readonly AnswerBlock[] = [
  BLOCK_SPEC_SHEET,
  BLOCK_DATA_TABLE,
  BLOCK_CHART,
  BLOCK_TIMELINE,
  BLOCK_TODO_LIST,
  BLOCK_IMAGE_GALLERY,
  BLOCK_SCHEDULE_CARD,
  BLOCK_COMPARISON,
];
