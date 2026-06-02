import { ImgHTMLAttributes } from "react"
import type { Environment } from "../../../src/shared/config-types"
import caretIcon from "./caret_icon.png?inline"

// Renders the brand-true Caret icon (PNG). Theme/environment tinting from the
// Cline robot mark is dropped — the Caret logo is a fixed-color brand asset.
const CaretLogoVariable = (props: ImgHTMLAttributes<HTMLImageElement> & { environment?: Environment }) => {
	const { environment: _environment, alt = "Caret", ...imgProps } = props
	return <img alt={alt} src={caretIcon} {...imgProps} />
}
export default CaretLogoVariable
