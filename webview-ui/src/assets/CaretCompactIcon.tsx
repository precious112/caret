import { ImgHTMLAttributes } from "react"
import caretIcon from "./caret_icon.png?inline"

export const CaretCompactIcon = (props: ImgHTMLAttributes<HTMLImageElement>) => {
	const { alt = "Caret", height = 16, width = 16, ...imgProps } = props
	return <img alt={alt} height={height} src={caretIcon} width={width} {...imgProps} />
}
