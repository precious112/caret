import { ImgHTMLAttributes } from "react"
import type { Environment } from "../../../src/shared/config-types"
import CaretLogoVariable from "./CaretLogoVariable"

// TODO(caret-rebrand): sleepy "Lazy Teammate Mode" variant dropped with Cline rebrand.
// Falls back to the standard Caret logo until we design a tired Caret expression.
const CaretLogoTired = (props: ImgHTMLAttributes<HTMLImageElement> & { environment?: Environment }) => (
	<CaretLogoVariable {...props} />
)
export default CaretLogoTired
