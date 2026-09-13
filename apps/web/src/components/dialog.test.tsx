// @vitest-environment jsdom
import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, Dialog, PromptDialog } from "./dialog";

describe("Dialog", () => {
  it("moves focus into the panel on open and returns it to the trigger on close", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          <Dialog open={open} onOpenChange={setOpen} title="Example">
            <button>Inside</button>
          </Dialog>
        </div>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Example" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes on backdrop click", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Example">
        <button>Inside</button>
      </Dialog>,
    );
    // The backdrop is the dialog's own overlay sibling — clicking anywhere
    // outside the panel should request a close.
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.previousElementSibling as HTMLElement;
    await user.click(backdrop);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("honors initialFocusRef instead of the first focusable element", async () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Dialog open onOpenChange={() => {}} title="Example" initialFocusRef={ref}>
          <button>First</button>
          <button ref={ref}>Focus me</button>
        </Dialog>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Focus me" })).toHaveFocus());
  });
});

describe("ConfirmDialog", () => {
  it("defaults focus to Cancel so Enter never triggers the destructive action", async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete this draft load?"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("calls onConfirm only when the confirm button is activated", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete this draft load?"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("cancelling calls onOpenChange(false) without calling onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete this draft load?"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("PromptDialog", () => {
  it("submits the trimmed input value", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        open
        onOpenChange={() => {}}
        title="Cancel this load?"
        label="Reason for cancelling (optional)"
        submitLabel="Cancel load"
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByLabelText("Reason for cancelling (optional)");
    await user.type(input, "  Customer changed plans  ");
    await user.click(screen.getByRole("button", { name: "Cancel load" }));
    expect(onSubmit).toHaveBeenCalledWith("Customer changed plans");
  });

  it("submits an empty string when the optional field is left blank", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        open
        onOpenChange={() => {}}
        title="Cancel this load?"
        label="Reason for cancelling (optional)"
        submitLabel="Cancel load"
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel load" }));
    expect(onSubmit).toHaveBeenCalledWith("");
  });
});
