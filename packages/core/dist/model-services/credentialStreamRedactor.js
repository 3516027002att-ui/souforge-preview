export class CredentialStreamRedactor {
    credential;
    redact;
    pending = '';
    spans = [];
    constructor(credential, redact) {
        this.credential = credential;
        this.redact = redact;
        if (Buffer.byteLength(credential, 'utf8') > 4096) {
            throw Object.assign(new Error('Credential exceeds the bounded streaming redaction budget.'), { code: 'AGENT_CREDENTIAL_REDACTION_BUDGET_EXCEEDED' });
        }
    }
    get retainedCharacters() { return this.pending.length; }
    take(count, output, discard = false) {
        this.pending = this.pending.slice(count);
        while (count > 0) {
            const span = this.spans[0];
            const size = Math.min(count, span.text.length);
            if (!discard)
                this.append(output, span.type, span.text.slice(0, size));
            if (size === span.text.length)
                this.spans.shift();
            else
                span.text = span.text.slice(size);
            count -= size;
        }
    }
    append(output, type, text) {
        if (!text)
            return;
        const safe = this.redact(text);
        const last = output.at(-1);
        if (last?.type === type)
            last.text += safe;
        else
            output.push({ type, text: safe });
    }
    push(delta) {
        if (!delta.text)
            return [];
        if (!this.credential)
            return [{ ...delta, text: this.redact(delta.text) }];
        this.pending += delta.text;
        this.spans.push({ ...delta });
        const output = [];
        let match;
        while ((match = this.pending.indexOf(this.credential)) >= 0) {
            this.take(match, output);
            const type = this.spans[0].type;
            this.take(this.credential.length, output, true);
            this.append(output, type, '[REDACTED]');
        }
        let retained = Math.min(this.pending.length, this.credential.length - 1);
        while (retained > 0 && !this.pending.endsWith(this.credential.slice(0, retained)))
            retained--;
        this.take(this.pending.length - retained, output);
        return output;
    }
    flush() {
        // An interrupted/truncated credential prefix also stays private.
        const output = [];
        if (this.spans.length)
            this.append(output, this.spans[0].type, '[REDACTED]');
        this.pending = '';
        this.spans = [];
        return output;
    }
}
//# sourceMappingURL=credentialStreamRedactor.js.map