import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { hubErrorMessage } from "@/lib/hubReachability";

type Options<TData, TVariables> = Omit<UseMutationOptions<TData, unknown, TVariables>, "mutationFn" | "onError"> & {
  mutationFn: (variables: TVariables) => Promise<TData>;
  verb: string;
};

/** The shared Home action pattern: report failures and contain them for event handlers. */
export function useHubMutation<TData = unknown, TVariables = void>({ verb, ...options }: Options<TData, TVariables>) {
  const mutation = useMutation<TData, unknown, TVariables>({
    ...options,
    onError: (error) => toast.error(`${hubErrorMessage(error, `Could not ${verb}.`)} Check your connection and try again.`),
  });
  const run = async (variables: TVariables) => {
    if (mutation.isPending) return undefined;
    try { return await mutation.mutateAsync(variables); }
    catch { return undefined; }
  };
  return { ...mutation, busy: mutation.isPending, run };
}
