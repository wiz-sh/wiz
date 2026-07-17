export interface FormatOptions {
    indentStyle?: "space" | "tab";
    indentWidth?: number;
    lineWidth?: number;
    trailingNewline?: boolean;
}

export const defaultFormatOptions: Required<FormatOptions> = {
    indentStyle: "space",
    indentWidth: 4,
    lineWidth: 100,
    trailingNewline: true,
};
