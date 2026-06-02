import { ImgHTMLAttributes } from "react"
import caretIcon from "./caret_icon.png?inline"

// TODO(caret-rebrand): true black variant pending. Uses the colored brand asset
// for now since Caret only ships a single-color logo.
const CaretLogoBlack = (props: ImgHTMLAttributes<HTMLImageElement>) => {
	const { alt = "Caret", ...imgProps } = props
	return <img alt={alt} src={caretIcon} {...imgProps} />
}
export default CaretLogoBlack
