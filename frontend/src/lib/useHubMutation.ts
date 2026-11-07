import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { i18n } from "@lingui/core";
import { toast } from "sonner";
import { couldNotLine } from "@/lib/hubMutationVerbs";
import { errorLine } from "@/lib/hubReachability";

type Options<TData, TVariables> = Omit<UseMutationOptions<TData, unknown, TVariables>, "mutationFn" | "onError"> & {
  mutationFn: (variables: TVariables) => Promise<TData>;
  verb: string;
};

/** The shared Home action pattern: report failures and contain them for event handlers. */
export function useHubMutation<TData = unknown, TVariables = void>({ verb, ...options }: Options<TData, TVariables>) {
  const mutation = useMutation<TData, unknown, TVariables>({
    ...options,
    onError: (error) => toast.error(`${errorLine(error, couldNotLine(verb))} ${i18n._({ id: "Check your connection and try again.", message: "Check your connection and try again." })}`),
  });
  const run = async (variables: TVariables) => {
    if (mutation.isPending) return undefined;
    try { return await mutation.mutateAsync(variables); }
    catch { return undefined; }
  };
  return { ...mutation, busy: mutation.isPending, run };
}
