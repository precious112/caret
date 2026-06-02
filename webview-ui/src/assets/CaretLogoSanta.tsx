import { ImgHTMLAttributes } from "react"
import type { Environment } from "../../../src/shared/config-types"
import CaretLogoVariable from "./CaretLogoVariable"

// TODO(caret-rebrand): festive Santa variant dropped with Cline rebrand.
// Falls back to the standard Caret logo until we design a Caret-branded seasonal variant.
const CaretLogoSanta = (props: ImgHTMLAttributes<HTMLImageElement> & { environment?: Environment }) => (
	<CaretLogoVariable {...props} />
)
export default CaretLogoSanta
