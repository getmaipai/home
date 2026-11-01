// The list action names alone, so a bench script can read them without opening the database.
export const LIST_ACTIONS = ["create_list", "rename_list", "delete_list", "add_items", "remove_items", "check_items", "uncheck_items", "edit_item", "move_items", "copy_list", "reorder", "clear_done", "show_list", "find_list"] as const;
export type ListAction = (typeof LIST_ACTIONS)[number];
