import { useEffect, useRef } from "react";

/**
 * Empresa con UN solo local: todo se imputa a ese local (pedido del usuario, 07-oct-2026).
 *
 * Preselecciona el local en un formulario mientras el campo esté vacío. Lo hace UNA vez por
 * `resetKey` (por ejemplo, cada vez que se abre el diálogo): si el usuario después elige a
 * propósito otra opción ("sin local"), no se le vuelve a pisar. El selector sigue visible y se
 * puede cambiar.
 */
export function useAutoSelectSingleLocal(
  locals: ReadonlyArray<{ id: number }> | undefined,
  isEmpty: boolean,
  select: (localId: number) => void,
  resetKey: unknown = null,
) {
  const onlyId = locals && locals.length === 1 ? locals[0].id : null;
  const done = useRef(false);
  const lastKey = useRef(resetKey);
  if (lastKey.current !== resetKey) {
    lastKey.current = resetKey;
    done.current = false;
  }
  useEffect(() => {
    if (onlyId == null || done.current) return;
    // Si el campo ya tenía un valor (una edición), el usuario manda: no se toca más.
    done.current = true;
    if (isEmpty) select(onlyId);
    // `select` suele ser una función nueva en cada render; no tiene que disparar el efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyId, isEmpty, resetKey]);
}
