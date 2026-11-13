// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InfoHint } from "./info-hint";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document.documentElement, "clientWidth");
});

it("keeps a hint within a narrow scrolling container, including after resize", () => {
  const { container } = render(
    <div style={{ overflowX: "auto" }}>
      <InfoHint label="Explain revenue">Revenue information</InfoHint>
    </div>,
  );
  const boundary = container.firstElementChild as HTMLElement;
  const button = screen.getByRole("button", { name: "Explain revenue" });
  const root = button.parentElement!;
  const panel = screen.getByRole("tooltip", { hidden: true });

  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 360 });
  Object.defineProperty(boundary, "clientWidth", { configurable: true, value: 320 });
  vi.spyOn(boundary, "getBoundingClientRect").mockReturnValue({ left: 20 } as DOMRect);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ left: 165, right: 181 } as DOMRect);
  vi.spyOn(panel, "getBoundingClientRect").mockImplementation(() => ({
    width: Math.min(288, Number.parseFloat(panel.style.maxWidth)),
  }) as DOMRect);

  fireEvent.click(button);
  expect(panel.style.maxWidth).toBe("296px");
  expect(panel.style.left).toBe("-125px");
  expect(button.getAttribute("aria-expanded")).toBe("true");

  Object.defineProperty(boundary, "clientWidth", { configurable: true, value: 200 });
  fireEvent(window, new Event("resize"));
  expect(panel.style.maxWidth).toBe("176px");
  expect(panel.style.left).toBe("-133px");
});
