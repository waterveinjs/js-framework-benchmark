import {
    createState,
    read,
    write,
    UISystem,
    batch,
    createSelector
} from '@watervein/core';
import { For } from '@watervein/dom-core';
import { tr, td, a, span, tbody } from '@watervein/dom';

let idCounter = 1;

const adjectives = ["pretty","large","big","small","tall","short","long","handsome","plain","quaint","clean","elegant","easy","angry","crazy","helpful","mushy","odd","unsightly","adorable","important","inexpensive","cheap","expensive","fancy"];
const colours    = ["red","yellow","blue","green","pink","brown","purple","tan","sky","salmon","silver","golden","white","black","orange","violet","gray","bronze","olive","navy","maroon","coral","magenta","teal","indigo"];
const nouns      = ["table","chair","house","bbq","desk","car","pony","cookie","sandwich","burger","pizza","mouse","keyboard","monitor","phone","tablet","laptop","server","cable","battery","printer","scanner","router","switch","hub"];

const adjLen = adjectives.length;
const colLen = colours.length;
const nounLen = nouns.length;

function buildData(count: number): RowData[] {
    const data: RowData[] = new Array(count);
    for (let i = 0; i < count; i++) {
        data[i] = {
            id: idCounter++,
            label: `${adjectives[(Math.random() * adjLen) | 0]} ${colours[(Math.random() * colLen) | 0]} ${nouns[(Math.random() * nounLen) | 0]}`,
        };
    }
    return data;
}

type RowData = {
    id: number;
    label: string;
};

const selectedId = createState<number | null>(null);
const isSelected = createSelector(selectedId as any);
const rows = createState<RowData[]>([]);

function selectRow(id: number) {
    if (read(selectedId) === id) return;
    write(selectedId, id);
    UISystem.flush();
}

function deleteRow(id: number) {
    if (read(selectedId) === id) {
        write(selectedId, null);
    }
    const current = read(rows);
    const next = current.filter(r => r.id !== id);
    write(rows, next);
    UISystem.flush();
}

const listNode = For<RowData>(
    rows,
    (row) => row.id,
    (row) => {
        const item = row();
        const id = item.id;

        return tr({
            class: () => (isSelected(id) ? "danger" : ""),
        }, [
            td({ class: "col-md-1" }, String(id)),

            td({ class: "col-md-4" }, [
                a({
                    class: "lbl",
                    onclick: (e: Event) => {
                        e.stopPropagation();
                        selectRow(id);
                    },
                }, () => row().label)
            ]),

            td({ class: "col-md-1" }, [
                a({
                    onclick: (e: Event) => {
                        e.stopPropagation();
                        deleteRow(id);
                    }
                }, [
                    span({ class: "glyphicon glyphicon-remove", "aria-hidden": "true" })
                ])
            ]),

            td({ class: "col-md-6" }),
        ]);
    }
);

const table = document.querySelector<HTMLElement>("table.test-data")!;
const newTbody = tbody({}, [listNode.fragment]);
const oldTbody = table.querySelector("tbody");

if (oldTbody) {
    oldTbody.replaceWith(newTbody);
} else {
    table.appendChild(newTbody);
}

document.getElementById("run")!.addEventListener("click", () => {
    batch(() => {
        write(selectedId, null);
        write(rows, buildData(1000));
    });
    UISystem.flush();
});

document.getElementById("runlots")!.addEventListener("click", () => {
    batch(() => {
        write(selectedId, null);
        write(rows, buildData(10000));
    });
    UISystem.flush();
});

document.getElementById("add")!.addEventListener("click", () => {
    write(rows, read(rows).concat(buildData(1000)));
    UISystem.flush();
});

document.getElementById("update")!.addEventListener("click", () => {
    const currentRows = read(rows);
    const len = currentRows.length;
    if (len === 0) return;

    const nextRows = currentRows.slice();

    for (let i = 0; i < len; i += 10) {
        const r = currentRows[i];
        nextRows[i] = { id: r.id, label: r.label + " !!!" };
    }

    write(rows, nextRows);
    UISystem.flush();
});

document.getElementById("clear")!.addEventListener("click", () => {
    batch(() => {
        write(selectedId, null);
        write(rows, []);
    });
    UISystem.flush();
});

document.getElementById("swaprows")!.addEventListener("click", () => {
    const currentRows = read(rows);
    if (currentRows.length < 999) return;

    const next = currentRows.slice();
    const tmp = next[1];
    next[1] = next[998];
    next[998] = tmp;

    write(rows, next);
    UISystem.flush();
});