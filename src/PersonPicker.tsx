import { PEOPLE, PERSON_GROUPS } from "./people";

export function PersonPicker({ person, onPerson, onCategory }: { person: string; onPerson: (name: string) => void; onCategory: (category: string) => void }) {
  const selected = PEOPLE.find((item) => item.name === person);
  return <label><span>인물명</span>
    <select aria-label="100인 목록에서 인물 선택" value={selected?.name || ""} onChange={(event) => {
      const choice = PEOPLE.find((item) => item.name === event.target.value);
      if (choice) { onPerson(choice.name); onCategory(choice.category); }
      else onPerson("");
    }}>
      <option value="">직접 입력 / 100인 목록에서 선택</option>
      {PERSON_GROUPS.map((group) => <optgroup key={group.title} label={group.title}>{group.people.map((item) => <option key={item.number} value={item.name}>{item.number}. {item.name}</option>)}</optgroup>)}
    </select>
    <input style={{ marginTop: 8 }} aria-label="인물명 직접 입력" placeholder="또는 인물명을 직접 입력" value={person} onChange={(event) => onPerson(event.target.value)} />
  </label>;
}
