import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import {
  ActionButton,
  CatalogueCard,
  CatalogueCardFooter,
  CatalogueCardHeader,
  CatalogueCardMedia,
  CountLabel,
  EditorialHeading,
  FilterTab,
  MonoLabel,
  PageRule,
  VocabularyChip,
  padCount,
} from ".";

function renderRouted(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("CountLabel", () => {
  it("zero-pads a catalogue index and announces it in full", () => {
    render(<CountLabel value={1} total={28} />);
    const label = screen.getByLabelText("01 of 28");
    expect(label).toHaveTextContent("01");
    expect(label).toHaveTextContent("28");
  });

  it("renders a bare count without a separator", () => {
    render(<CountLabel value={28} />);
    expect(screen.getByLabelText("28")).not.toHaveTextContent("/");
  });

  it("pads defensively", () => {
    expect(padCount(3, 2)).toBe("03");
    expect(padCount(128, 2)).toBe("128");
    expect(padCount(Number.NaN, 2)).toBe("00");
  });
});

describe("FilterTab", () => {
  it("prints the label with its live count", () => {
    renderRouted(<FilterTab label="Dither Mono" count={5} to="/type/dither-mono" />);
    const tab = screen.getByRole("link", { name: /dither mono/i });
    expect(tab).toHaveTextContent("5");
    expect(tab).toHaveAttribute("href", "/type/dither-mono");
  });

  it("falls back to a button and reports its pressed state", async () => {
    const onSelect = vi.fn();
    renderRouted(<FilterTab label="All" count={28} active onSelect={onSelect} />);
    const tab = screen.getByRole("button", { name: /all/i });
    expect(tab).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(tab);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("does not link when disabled", () => {
    renderRouted(<FilterTab label="Empty" count={0} to="/type/empty" disabled />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: /empty/i })).toBeDisabled();
  });
});

describe("VocabularyChip", () => {
  it("renders a term and an overflow tail", () => {
    render(
      <>
        <VocabularyChip>halftone CMYK dot texture</VocabularyChip>
        <VocabularyChip overflow>+4</VocabularyChip>
      </>,
    );
    expect(screen.getByText("halftone CMYK dot texture")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
  });
});

describe("ActionButton", () => {
  it("defaults to a non-submitting button", () => {
    render(<ActionButton>Copy brief</ActionButton>);
    expect(screen.getByRole("button", { name: "Copy brief" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("does not fire while disabled", () => {
    const onClick = vi.fn();
    render(
      <ActionButton disabled onClick={onClick}>
        Copy brief
      </ActionButton>,
    );
    const button = screen.getByRole("button", { name: "Copy brief" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("EditorialHeading", () => {
  it("renders at the requested level with an eyebrow", () => {
    render(
      <EditorialHeading level={1} scale="display" eyebrow="Design type">
        Dither Mono
      </EditorialHeading>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Dither Mono",
    );
    expect(screen.getByText("Design type")).toBeInTheDocument();
  });
});

describe("MonoLabel and PageRule", () => {
  it("renders as the requested element", () => {
    render(<MonoLabel as="p">Print-Tech Paper</MonoLabel>);
    expect(screen.getByText("Print-Tech Paper").tagName).toBe("P");
  });

  it("renders a separator element", () => {
    const { container } = render(<PageRule weight="heavy" />);
    expect(container.querySelector("hr")).not.toBeNull();
  });
});

describe("CatalogueCard shell", () => {
  it("composes media, header and footer without an image", () => {
    render(
      <CatalogueCard>
        <CatalogueCardMedia fallback="Awaiting capture" />
        <CatalogueCardHeader
          headline={<EditorialHeading level={3} scale="card">Stillpage</EditorialHeading>}
          aside="warm editorial x print DNA"
        />
        <CatalogueCardFooter lead="Print-Tech Paper" trail={<CountLabel value={1} total={28} />} />
      </CatalogueCard>,
    );

    expect(screen.getByText("Awaiting capture")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Stillpage");
    expect(screen.getByText("warm editorial x print DNA")).toBeInTheDocument();
    expect(screen.getByLabelText("01 of 28")).toBeInTheDocument();
  });

  it("renders the thumbnail when one is supplied", () => {
    render(
      <CatalogueCard>
        <CatalogueCardMedia src="/thumb.webp" alt="Stillpage capture" />
      </CatalogueCard>,
    );
    const image = screen.getByAltText("Stillpage capture");
    expect(image).toHaveAttribute("src", "/thumb.webp");
    expect(image).toHaveAttribute("loading", "lazy");
  });
});
