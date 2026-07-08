import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'

/** Creates a typed useQuery hook keyed to a specific IPC call. */
export function useIpcQuery<T>(
  queryKey: string[],
  queryFn: () => Promise<T>,
  options?: { enabled?: boolean },
) {
  return useQuery<T, Error>({
    queryKey,
    queryFn,
    staleTime: 30_000,
    ...options,
  })
}

/**
 * Creates a typed useMutation hook that invalidates the given query keys on success.
 * Designed for CRUD operations: after a create/update/delete, refresh the list.
 */
export function useIpcMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidateKeys: string[][],
  options?: {
    onSuccessMessage?: string
  },
) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation<TData, Error, TVariables>({
    mutationFn,
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key })
      }
      if (options?.onSuccessMessage) {
        addToast(options.onSuccessMessage, 'success')
      }
    },
    onError: (err) => {
      addToast(err.message || String(err), 'error')
    },
    ...options,
  })
}
