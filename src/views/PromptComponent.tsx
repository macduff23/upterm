import * as _ from "lodash";
import * as React from "react";
import {AutocompleteComponent} from "./AutocompleteComponent";
import {getCaretPosition, setCaretPosition} from "./ViewUtils";
import {Prompt} from "../shell/Prompt";
import {SuggestionWithDefaults} from "../plugins/autocompletion_utils/Common";
import {KeyCode} from "../Enums";
import {getSuggestions} from "../Autocompletion";
import {scan} from "../shell/Scanner";
import {Session} from "../shell/Session";
import {services} from "../services/index";

interface Props {
    session: Session;
    isFocused: boolean;
}

interface State {
    highlightedSuggestionIndex: number;
    previousKeyCode: number;
    caretPositionFromPreviousFocus: number;
    suggestions: SuggestionWithDefaults[];
    displayedHistoryRecordID: number | undefined;
}

export class PromptComponent extends React.Component<Props, State> {
    private prompt: Prompt;

    /* tslint:disable:member-ordering */
    constructor(props: Props) {
        super(props);
        this.prompt = new Prompt(this.props.session);

        this.state = {
            highlightedSuggestionIndex: 0,
            previousKeyCode: KeyCode.Escape,
            caretPositionFromPreviousFocus: 0,
            suggestions: [],
            displayedHistoryRecordID: undefined,
        };
    }

    componentDidMount() {
        this.focus();
    }

    componentDidUpdate(prevProps: Props) {
        if (!prevProps.isFocused && this.props.isFocused) {
            this.focus();
        }
    }

    render() {
        const showAutocomplete = this.showAutocomplete();
        const autocomplete = showAutocomplete ?
            <AutocompleteComponent
                suggestions={this.state.suggestions}
                caretPosition={getCaretPosition(this.commandNode)}
                onSuggestionHover={index => this.setState({...this.state, highlightedSuggestionIndex: index})}
                onSuggestionClick={this.applySuggestion.bind(this)}
                highlightedIndex={this.state.highlightedSuggestionIndex}
                ref="autocomplete"
            /> :
            null;

        const completed = showAutocomplete ? this.valueWithCurrentSuggestion : "";
        const showAutocompletedPreview = showAutocomplete && completed.trim() !== this.prompt.value && completed.startsWith(this.prompt.value);
        const autocompletedPreview = showAutocompletedPreview ?
            <div className="autocompleted-preview prompt-content">{completed}</div> :
            null;

        return (
            <div className="prompt">
                <div className="prompt-decoration">
                    <div className="square"/>
                    <div className="square rhombus"/>
                </div>
                <div
                    className="prompt-content"
                    onInput={this.handleInput.bind(this)}
                    onDrop={this.handleDrop.bind(this)}
                    onBlur={() => this.setState({
                        ...this.state,
                        caretPositionFromPreviousFocus: getCaretPosition(this.commandNode),
                    })}
                    ref="command"
                    contentEditable={true}
                />
                {autocompletedPreview}
                {autocomplete}
            </div>
        );
    }

    focus(): void {
        if (document.activeElement === this.commandNode) {
            return;
        }

        this.commandNode.focus();

        if (this.prompt.value) {
            setCaretPosition(this.commandNode, this.state.caretPositionFromPreviousFocus);
        }
    }

    clear(): void {
        this.setText("");
    }

    setPreviousKeyCode(event: KeyboardEvent) {
        this.setState({
            ...this.state,
            previousKeyCode: event.keyCode,
        });
    }

    async appendLastLArgumentOfPreviousCommand(): Promise<void> {
        const latestHistoryRecord = services.history.latest;

        if (latestHistoryRecord) {
            this.setText(this.prompt.value + _.last(scan(latestHistoryRecord.command))!.value);
        }
    }

    async execute(promptText: string): Promise<void> {
        this.prompt.setValue(promptText);

        if (!this.isEmpty()) {
            this.props.session.createJob(this.prompt);
            this.setDOMValueProgrammatically("");
            this.setState({
                highlightedSuggestionIndex: 0,
                previousKeyCode: KeyCode.Escape,
                caretPositionFromPreviousFocus: 0,
                suggestions: [],
                displayedHistoryRecordID: undefined,
            });
        }
    }

    setPreviousHistoryItem(): void {
        const currentID = this.state.displayedHistoryRecordID;
        if (currentID) {
            const currentRecord = services.history.get(currentID);
            const previousRecord = _.findLast(
                services.history.all,
                record => record.id < currentID && record.command !== currentRecord.command,
            );

            if (previousRecord) {
                this.setText(previousRecord.command);
                this.setState({displayedHistoryRecordID: previousRecord.id});
            }
        } else {
            const previousRecord = services.history.latest;
            if (previousRecord) {
                this.setText(previousRecord.command);
                this.setState({displayedHistoryRecordID: previousRecord.id});
            }
        }
    }

    setNextHistoryItem(): void {
        const currentID = this.state.displayedHistoryRecordID;
        if (currentID) {
            const currentRecord = services.history.get(currentID);
            const nextRecord = _.find(
                services.history.all,
                record => record.id > currentID && record.command !== currentRecord.command,
            );
            if (nextRecord) {
                this.setText(nextRecord.command);
                this.setState({displayedHistoryRecordID: nextRecord.id});
            } else {
                this.setText("");
                this.setState({displayedHistoryRecordID: undefined});
            }
        }
    }

    focusPreviousSuggestion(): void {
        const index = Math.max(0, this.state.highlightedSuggestionIndex - 1);
        this.setState({...this.state, highlightedSuggestionIndex: index});
    }

    focusNextSuggestion(): void {
        const index = Math.min(this.state.suggestions.length - 1, this.state.highlightedSuggestionIndex + 1);
        this.setState({...this.state, highlightedSuggestionIndex: index});
    }

    isAutocompleteShown(): boolean {
        /* tslint:disable:no-string-literal */
        return !!this.refs["autocomplete"];
    }

    async applySuggestion(): Promise<void> {
        this.setText(this.valueWithCurrentSuggestion);
        await this.getSuggestions();
    }

    private setText(text: string): void {
        this.prompt.setValue(text);
        this.setDOMValueProgrammatically(text);
    }

    private get commandNode(): HTMLInputElement {
        /* tslint:disable:no-string-literal */
        return this.refs["command"] as HTMLInputElement;
    }

    private setDOMValueProgrammatically(text: string): void {
        this.commandNode.innerText = text;
        const newCaretPosition = text.length;
        /**
         * Without this line caret position is incorrect when you click on a suggestion
         * because the prompt temporarily loses focus and then restores the previous position.
         */
        (this.state as any).caretPositionFromPreviousFocus = newCaretPosition;

        if (text.length) {
            setCaretPosition(this.commandNode, newCaretPosition);
        }

        this.setState({suggestions: [], highlightedSuggestionIndex: 0});
    }

    private isEmpty(): boolean {
        return this.prompt.value.replace(/\s/g, "").length === 0;
    }

    private get valueWithCurrentSuggestion(): string {
        const suggestion = this.state.suggestions[this.state.suggestions.length - 1 - this.state.highlightedSuggestionIndex];

        return suggestion.promptSerializer({
            ast: this.prompt.ast,
            caretPosition: getCaretPosition(this.commandNode),
            suggestion: suggestion,
        });
    }

    private showAutocomplete(): boolean {
        const ignoredKeyCodes = [
            KeyCode.CarriageReturn,
            KeyCode.Escape,
            KeyCode.Up,
            KeyCode.Down,
        ];

        return this.props.isFocused &&
            this.state.suggestions.length > 0 &&
            this.commandNode && !this.isEmpty() &&
            !ignoredKeyCodes.includes(this.state.previousKeyCode);
    }

    private async handleInput(event: React.SyntheticEvent<HTMLElement>): Promise<void> {
        this.prompt.setValue((event.target as HTMLElement).innerText);

        await this.getSuggestions();
    }

    private async getSuggestions() {
        let suggestions = await getSuggestions({
            currentText: this.prompt.value,
            currentCaretPosition: getCaretPosition(this.commandNode),
            ast: this.prompt.ast,
            environment: this.props.session.environment,
            historicalPresentDirectoriesStack: this.props.session.historicalPresentDirectoriesStack,
            aliases: this.props.session.aliases,
        });

        this.setState({...this.state, highlightedSuggestionIndex: suggestions.length - 1, suggestions: suggestions});
    }

    private handleDrop(event: DragEvent) {
        this.setText(this.prompt.value + (event.dataTransfer.files[0].path));
    }
}
