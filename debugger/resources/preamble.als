open util/boolean
open util/ternary

abstract sig SymbVal {}
sig Snap extends SymbVal {}
one sig Unit extends Snap {}

abstract sig Perm {
    num: one Int,
    denom: one Int
} {
    num >= 0
    denom > 0
    num <= denom
}
one sig W in Perm {} {
    num = 1
    denom = 1
}
one sig Z in Perm {} {
    num = 0
    denom = 1
}

abstract sig Combine extends Snap {
    left: one SymbVal,
    right: one SymbVal
}
fun combine [ l, r: Snap ]: Snap {
    { c: Combine | c.left = l && c.right = r }
}