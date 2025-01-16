export class StringBuilder {
    constructor() {
        this.strings = [];
    }
    append(value) {
        this.strings.push(value);
        return this;
    }
    values() { return this.strings; }
    toString() {
        return this.strings.join('');
    }
    clear() {
        this.strings = [];
    }
}
