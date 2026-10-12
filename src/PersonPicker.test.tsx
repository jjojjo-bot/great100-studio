// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PersonPicker } from "./PersonPicker";

afterEach(cleanup);

it("selects a listed person and category while retaining direct entry", () => {
  function Form() {
    const [person, setPerson] = useState("");
    const [category, setCategory] = useState("");
    return <><PersonPicker person={person} onPerson={setPerson} onCategory={setCategory} /><output>{category}</output></>;
  }
  render(<Form />);
  const picker = screen.getByLabelText("100인 목록에서 인물 선택") as HTMLSelectElement;
  const input = screen.getByLabelText("인물명 직접 입력") as HTMLInputElement;
  expect(picker.options.length).toBe(101);
  fireEvent.change(picker, { target: { value: "김연아" } });
  expect(input.value).toBe("김연아");
  expect(screen.getByText("스포츠", { selector: "output" })).toBeTruthy();
  fireEvent.change(input, { target: { value: "직접 입력한 인물" } });
  expect(input.value).toBe("직접 입력한 인물");
  expect(picker.value).toBe("");
});
