import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CodeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmCode: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function CodeConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmCode,
  confirmLabel = "Eliminar",
  cancelLabel = "Cancelar",
  onConfirm,
  isLoading = false,
}: CodeConfirmDialogProps) {
  const [inputCode, setInputCode] = useState("");

  useEffect(() => {
    if (!open) setInputCode("");
  }, [open]);

  const isValid = inputCode === confirmCode;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Escriba el codigo <span className="font-mono font-bold text-foreground">{confirmCode}</span> para confirmar:
          </p>
          <Input
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            placeholder="Ingrese el codigo"
            data-testid="input-confirm-code"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading} data-testid="button-cancel-dialog">
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            onClick={onConfirm}
            disabled={isLoading || !isValid}
            variant="destructive"
            data-testid="button-confirm-dialog"
          >
            {isLoading ? "Procesando..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
