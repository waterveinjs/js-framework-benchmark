import {
    createState,
    read,
    write,
    UISystem,
    batch,
} from '@watervein/core';
import { For, mount } from '@watervein/dsl1';
import { tr, td, a, span } from '@watervein/dsl1/elements';

let idCounter = 1;

const adjectives = ["pretty","large","big","small","tall","short","long","handsome","plain","quaint","clean","elegant","easy","angry","crazy","helpful","mushy","odd","unsightly","adorable","important","inexpensive","cheap","expensive","fancy"];
const colours    = ["red","yellow","blue","green","pink","brown","purple","tan","sky","salmon","silver","golden","white","black","orange","violet","gray","bronze","olive","navy","maroon","coral","magenta","teal","indigo"];
const nouns      = ["table","chair","house","bbq","desk","car","pony","cookie","sandwich","burger","pizza","mouse","keyboard","monitor","phone","tablet","laptop","server","cable","battery","printer","scanner","router","switch","hub"];

function rand(max: number) { return Math.round(Math.random() * 1000) % max; }

type Row = { id: number; label: string };

function buildData(count: number): Row[] {
    const data: Row[] = new Array(count);
    for (let i = 0; i < count; i++) {
        data[i] = {
            id: idCounter++,
            label: `${adjectives[rand(adjectives.length)]} ${colours[rand(colours.length)]} ${nouns[rand(nouns.length)]}`,
        };
    }
    return data;
}

const rowMap   = createState<Map<number, Row>>(new Map());
const rowOrder = createState<number[]>([]);
const selected = createState<number>(0);

function setRows(data: Row[]) {
    batch(() => {
        write(rowMap,   new Map(data.map(r => [r.id, r])));
        write(rowOrder, data.map(r => r.id));
        write(selected, 0);
    });
}

const tbody = document.querySelector<HTMLElement>("table.test-data")!;

const list = For<number>(
    rowOrder,
    (id) => id,
    (id) => tr({
        class: () => read(selected) === id ? "danger" : "",
    }, [
        td({ class: "col-md-1" }, `${id}`),
        td({ class: "col-md-4" }, [
            a({
                onclick: () => write(selected, id),
            }, () => read(rowMap).get(id)?.label ?? "")
        ]),
        td({ class: "col-md-1" }, [
            a({ onclick: () => {
                const m = new Map(read(rowMap));
                m.delete(id);
                batch(() => {
                    write(rowMap,   m);
                    write(rowOrder, read(rowOrder).filter(x => x !== id));
                });
                UISystem.flush();
            }}, [
                span({ class: "remove glyphicon glyphicon-remove", "aria-hidden": "true" })
            ])
        ]),
        td({ class: "col-md-6" }),
    ])
);

mount(tbody, list);

document.getElementById("run")!.addEventListener("click", () => {
    setRows(buildData(1000));
    UISystem.flush();
});

document.getElementById("runlots")!.addEventListener("click", () => {
    setRows(buildData(10000));
    UISystem.flush();
});

document.getElementById("add")!.addEventListener("click", () => {
    const added = buildData(1000);
    batch(() => {
        const m = new Map(read(rowMap));
        for (const r of added) m.set(r.id, r);
        write(rowMap,   m);
        write(rowOrder, [...read(rowOrder), ...added.map(r => r.id)]);
    });
    UISystem.flush();
});

document.getElementById("update")!.addEventListener("click", () => {
    const order = read(rowOrder);
    const next  = new Map(read(rowMap));
    for (let i = 0; i < order.length; i += 10) {
        const row = next.get(order[i])!;
        next.set(order[i], { ...row, label: row.label + " !!!" });
    }
    write(rowMap, next);
    UISystem.flush();
});

document.getElementById("clear")!.addEventListener("click", () => {
    batch(() => {
        write(rowMap,   new Map());
        write(rowOrder, []);
        write(selected, 0);
    });
    UISystem.flush();
});

document.getElementById("swaprows")!.addEventListener("click", () => {
    const order = read(rowOrder);
    if (order.length < 999) return;
    const next  = [...order];
    const tmp   = next[1];
    next[1]     = next[998];
    next[998]   = tmp;
    write(rowOrder, next);
    UISystem.flush();
});
