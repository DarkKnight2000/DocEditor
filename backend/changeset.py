RETAIN = "retain"
INSERT = "insert"
DELETE = "delete"
ATTRIBUTES = "attributes"
INFINITY = float("inf")
import copy
import json


# ---------------------------------------------------------------------------
# AttributeMap helpers (mirrors AttributeMap.ts)
# ---------------------------------------------------------------------------

def attr_compose(a: dict, b: dict) -> dict:
    """Compose two attribute maps: b's keys overwrite a's; None values are dropped."""
    a = a or {}
    b = b or {}
    result = {**a}
    for k, v in b.items():
        if v is None:
            result.pop(k, None)
        else:
            result[k] = v
    return result


def attr_invert(attr: dict, base: dict) -> dict:
    """Return the attribute map that undoes *attr* when the original was *base*."""
    attr = attr or {}
    base = base or {}
    result = {}
    for k, v in base.items():
        if base[k] != attr.get(k) and k in attr:
            result[k] = base[k]
    for k, v in attr.items():
        if attr[k] != base.get(k) and k not in base:
            result[k] = None
    return result


def attr_transform(a: dict, b: dict, priority: bool = False) -> dict:
    """Transform attribute map *b* against *a*. With priority, *a* wins."""
    if not isinstance(a, dict):
        return b
    if not isinstance(b, dict):
        return None
    if not priority:
        return b  # b simply overwrites without priority
    # With priority: only keep keys from b that a did not set
    return {k: v for k, v in b.items() if k not in a}


# ---------------------------------------------------------------------------
# Op
# ---------------------------------------------------------------------------

class Op:
    def __init__(self, type="", value=None, attributes=None):
        self.type: str = type
        self.value = value
        self.attributes: dict = attributes or {}

    def length(self) -> int:
        if self.type == DELETE and isinstance(self.value, int):
            return self.value
        elif self.type == RETAIN and isinstance(self.value, int):
            return self.value
        elif self.type == RETAIN and self.value is not None:
            return 1
        elif self.type == INSERT and isinstance(self.value, str):
            return len(self.value)
        return 1

    def __repr__(self):
        return f"Op({self.type!r}, {self.value!r}, {self.attributes!r})"
    
    def __str__(self):
        ret = f'{{{json.dumps(self.type)}: '
        ret += f'{json.dumps(self.value)}'
        if self.attributes:
            ret += f', "attributes": {json.dumps(self.attributes)}'
        
        ret += f'}}'
        return ret


# ---------------------------------------------------------------------------
# OpIter
# ---------------------------------------------------------------------------

class OpIter:
    def __init__(self, ops: list):
        self.ops = ops
        self.index = 0   # op index
        self.offset = 0  # character offset into the current op

    def peek(self):
        if self.index >= len(self.ops):
            return None
        return self.ops[self.index]

    def peekLength(self) -> float:
        if self.index >= len(self.ops):
            return INFINITY
        return self.ops[self.index].length() - self.offset

    def peekType(self) -> str:
        if self.index >= len(self.ops):
            return RETAIN
        return self.ops[self.index].type

    def hasNext(self) -> bool:
        return self.peekLength() < INFINITY

    def next(self, length=None) -> Op:
        if length is None or length < 0:
            length = INFINITY

        nextOp = self.peek()
        if nextOp is None:
            return Op(RETAIN, INFINITY)

        offset = self.offset
        op_len = nextOp.length()
        remaining = op_len - offset

        if length >= remaining:
            length = remaining
            self.index += 1
            self.offset = 0
        else:
            self.offset += length

        if nextOp.type == DELETE:
            return Op(DELETE, length)

        retOp = Op()
        if nextOp.attributes:
            retOp.attributes = copy.deepcopy(nextOp.attributes)

        if nextOp.type == RETAIN and isinstance(nextOp.value, int):
            retOp.type = RETAIN
            retOp.value = length
        elif nextOp.type == RETAIN and nextOp.value is not None:
            # embed retain – offset must be 0, length must be 1
            retOp.type = RETAIN
            retOp.value = nextOp.value
        elif nextOp.type == INSERT and isinstance(nextOp.value, str):
            retOp.type = INSERT
            retOp.value = nextOp.value[offset: offset + length]
        else:
            # embed insert – offset must be 0, length must be 1
            retOp.type = INSERT
            retOp.value = nextOp.value

        return retOp

    def rest(self) -> list:
        if not self.hasNext():
            return []
        if self.offset == 0:
            return self.ops[self.index:]
        offset = self.offset
        index = self.index
        nxt = self.next()
        rest = self.ops[self.index:]
        self.offset = offset
        self.index = index
        return [nxt] + rest


# ---------------------------------------------------------------------------
# Delta
# ---------------------------------------------------------------------------

class Delta:
    def __init__(self, ops=None):
        if ops is None:
            ops = []
        if isinstance(ops, list):
            self.ops: list = ops
        elif isinstance(ops, dict) and "ops" in ops:
            self.ops: list = ops["ops"]
        else:
            self.ops: list = []

    # ------------------------------------------------------------------
    # Mutation helpers
    # ------------------------------------------------------------------

    def insert(self, arg, attributes=None):
        if isinstance(arg, str) and len(arg) == 0:
            return self
        newop = Op(INSERT, arg)
        if isinstance(attributes, dict) and len(attributes):
            newop.attributes = attributes
        return self.push(newop)

    def delete(self, length: int):
        if length <= 0:
            return self
        return self.push(Op(DELETE, length))

    def retain(self, length: int, attributes=None):
        if length <= 0:
            return self
        newop = Op(RETAIN, length)
        if isinstance(attributes, dict) and len(attributes):
            newop.attributes = attributes
        return self.push(newop)

    def push(self, newOp: Op):
        if not self.ops:
            self.ops.append(newOp)
            return self

        index = len(self.ops)
        lastOp: Op = self.ops[index - 1]

        if newOp.type == DELETE and lastOp.type == DELETE:
            self.ops[index - 1] = Op(DELETE, lastOp.value + newOp.value)
            return self

        # Always keep inserts before deletes
        if lastOp.type == DELETE and newOp.type == INSERT:
            index -= 1
            if index == 0:
                self.ops.insert(0, newOp)
                return self
            lastOp = self.ops[index - 1]

        if newOp.attributes == lastOp.attributes:
            if newOp.type == INSERT and lastOp.type == INSERT and isinstance(lastOp.value, str) and isinstance(newOp.value, str):
                self.ops[index - 1] = Op(INSERT, lastOp.value + newOp.value, lastOp.attributes)
                return self
            if newOp.type == RETAIN and lastOp.type == RETAIN and isinstance(lastOp.value, int) and isinstance(newOp.value, int):
                self.ops[index - 1] = Op(RETAIN, lastOp.value + newOp.value, lastOp.attributes)
                return self

        if index == len(self.ops):
            self.ops.append(newOp)
        else:
            self.ops.insert(index, newOp)

        return self

    def chop(self):
        if not self.ops:
            return self
        lastop = self.ops[-1]
        if lastop.type == RETAIN and not lastop.attributes:
            self.ops.pop()
        return self

    def concat(self, other: "Delta") -> "Delta":
        """Return a new Delta that is self followed by other."""
        delta = Delta(list(self.ops))
        if other.ops:
            delta.push(other.ops[0])
            delta.ops.extend(other.ops[1:])
        return delta

    # ------------------------------------------------------------------
    # Measurement
    # ------------------------------------------------------------------

    def length(self) -> int:
        return sum(op.length() for op in self.ops)

    def changeLen(self) -> int:
        total = 0
        for op in self.ops:
            if op.type == INSERT:
                total += op.length()
            elif op.type == DELETE:
                total -= op.value
        return total

    # ------------------------------------------------------------------
    # compose
    # ------------------------------------------------------------------

    def compose(self, other: "Delta") -> "Delta":
        """Apply *other* on top of *self* and return the resulting Delta."""
        thisIter = OpIter(self.ops)
        otherIter = OpIter(other.ops)
        ops = []

        # Optimisation: if other starts with a plain retain, carry through
        # any leading inserts from self unchanged.
        firstOther = otherIter.peek()
        if (firstOther and firstOther.type == RETAIN
                and isinstance(firstOther.value, int)
                and not firstOther.attributes):
            firstLeft = firstOther.value
            while thisIter.peekType() == INSERT and thisIter.peekLength() <= firstLeft:
                firstLeft -= thisIter.peekLength()
                ops.append(thisIter.next())
            if firstOther.value - firstLeft > 0:
                otherIter.next(firstOther.value - firstLeft)

        delta = Delta(ops)

        while thisIter.hasNext() or otherIter.hasNext():
            if otherIter.peekType() == INSERT:
                delta.push(otherIter.next())
            elif thisIter.peekType() == DELETE:
                delta.push(thisIter.next())
            else:
                length = min(thisIter.peekLength(), otherIter.peekLength())
                thisOp = thisIter.next(length)
                otherOp = otherIter.next(length)

                if otherOp.type == RETAIN:
                    # Determine new op type/value
                    if thisOp.type == RETAIN and isinstance(thisOp.value, int):
                        new_value = length if isinstance(otherOp.value, int) else otherOp.value
                        new_type = RETAIN
                    else:
                        new_value = thisOp.value
                        new_type = thisOp.type

                    # Compose attributes
                    new_attrs = attr_compose(thisOp.attributes, otherOp.attributes)

                    newOp = Op(new_type, new_value, new_attrs)
                    delta.push(newOp)

                elif otherOp.type == DELETE and thisOp.type == RETAIN:
                    delta.push(otherOp)
                # else: thisOp is DELETE and otherOp is DELETE – already handled above

        return delta.chop()

    # ------------------------------------------------------------------
    # transform
    # ------------------------------------------------------------------

    def transform(self, other, priority: bool = False):
        """
        Transform *other* against *self*.

        If *other* is a Delta, return a new transformed Delta.
        If *other* is an int (index), return the transformed index.
        *priority* - when True, self's inserts win ties over other's inserts.
        """
        if isinstance(other, int):
            return self.transform_position(other, priority)

        thisIter = OpIter(self.ops)
        otherIter = OpIter(other.ops)
        delta = Delta()

        while thisIter.hasNext() or otherIter.hasNext():
            if (thisIter.peekType() == INSERT
                    and (priority or otherIter.peekType() != INSERT)):
                # self inserts first (or has priority): other must skip over it
                delta.retain(thisIter.next().length())
            elif otherIter.peekType() == INSERT:
                delta.push(otherIter.next())
            else:
                length = min(thisIter.peekLength(), otherIter.peekLength())
                thisOp = thisIter.next(length)
                otherOp = otherIter.next(length)

                if thisOp.type == DELETE:
                    # self deleted this range – other's op on that range is void
                    continue
                elif otherOp.type == DELETE:
                    delta.push(otherOp)
                else:
                    # Both retain
                    new_attrs = attr_transform(thisOp.attributes, otherOp.attributes, priority)
                    delta.retain(
                        length if isinstance(otherOp.value, int) else otherOp.value,
                        new_attrs if new_attrs else None,
                    )

        return delta.chop()

    def transform_position(self, index: int, priority: bool = False) -> int:
        """Transform a cursor *index* through this Delta."""
        thisIter = OpIter(self.ops)
        offset = 0
        while thisIter.hasNext() and offset <= index:
            length = thisIter.peekLength()
            op_type = thisIter.peekType()
            thisIter.next()
            if op_type == DELETE:
                index -= min(length, index - offset)
            elif op_type == INSERT and (offset < index or not priority):
                index += length
                offset += length
            else:
                offset += length
        return index

    # ------------------------------------------------------------------
    # invert
    # ------------------------------------------------------------------

    def invert(self, base: "Delta") -> "Delta":
        """
        Return a Delta that undoes *self* when applied after *self* on *base*.
        i.e.  base.compose(self).compose(inverted) == base
        """
        inverted = Delta()
        baseIter = OpIter(base.ops)
        index = 0

        for op in self.ops:
            if op.type == INSERT:
                inverted.delete(op.length())

            elif op.type == RETAIN:
                if not op.attributes:
                    inverted.retain(op.value)
                    baseIter.next(op.value)
                else:
                    # Collect base ops covering this retain range
                    length = op.value
                    while length > 0:
                        base_op = baseIter.next(length)
                        base_len = base_op.length()
                        new_attrs = attr_invert(op.attributes, base_op.attributes)
                        inverted.retain(base_len, new_attrs if new_attrs else None)
                        length -= base_len

            elif op.type == DELETE:
                length = op.value
                while length > 0:
                    base_op = baseIter.next(length)
                    base_len = base_op.length()
                    inverted.insert(base_op.value, base_op.attributes if base_op.attributes else None)
                    length -= base_len

            index += op.length() if op.type != DELETE else 0

        return inverted.chop()

    # ------------------------------------------------------------------
    # diff  (requires fast-diff equivalent; uses simple fallback)
    # ------------------------------------------------------------------

    def diff(self, other: "Delta", cursor_pos: int = None) -> "Delta":
        """
        Return a Delta such that self.compose(diff) == other.
        Both deltas must be document deltas (only inserts).
        Uses a simple character-level diff via SequenceMatcher.
        """
        from difflib import SequenceMatcher

        def ops_to_str(delta):
            result = []
            for op in delta.ops:
                if op.type != INSERT:
                    raise ValueError("diff() requires document deltas (inserts only)")
                if not isinstance(op.value, str):
                    raise ValueError("diff() only supports string inserts")
                result.append(op.value)
            return "".join(result)

        a_str = ops_to_str(self)
        b_str = ops_to_str(other)

        delta = Delta()
        sm = SequenceMatcher(None, a_str, b_str, autojunk=False)
        a_iter = OpIter(self.ops)
        b_iter = OpIter(other.ops)

        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            a_len = i2 - i1
            b_len = j2 - j1
            if tag == "equal":
                # advance both iters; emit retain
                a_iter.next(a_len)
                b_iter.next(b_len)
                delta.retain(a_len)
            elif tag == "insert":
                # characters only in b
                b_iter.next(b_len)
                delta.insert(b_str[j1:j2])
            elif tag == "delete":
                # characters only in a
                a_iter.next(a_len)
                delta.delete(a_len)
            elif tag == "replace":
                # delete a_len, insert b_len
                a_iter.next(a_len)
                b_iter.next(b_len)
                delta.delete(a_len)
                delta.insert(b_str[j1:j2])

        return delta.chop()

    # ------------------------------------------------------------------
    # eachLine
    # ------------------------------------------------------------------

    def eachLine(self, predicate, newline: str = "\n"):
        """
        Iterate line segments. *predicate(line_delta, attributes, index)*.
        Return False from predicate to stop early.
        """
        iter_ = OpIter(self.ops)
        line = Delta()
        i = 0
        while iter_.hasNext():
            if iter_.peekType() != INSERT:
                return
            this_op = iter_.next()
            if not isinstance(this_op.value, str):
                line.push(this_op)
                continue
            start = 0
            idx = this_op.value.find(newline, start)
            while idx != -1:
                line.insert(this_op.value[start:idx], this_op.attributes or None)
                if predicate(line, this_op.attributes or {}, i) is False:
                    return
                i += 1
                line = Delta()
                start = idx + 1
                idx = this_op.value.find(newline, start)
            if start < len(this_op.value):
                line.insert(this_op.value[start:], this_op.attributes or None)
        if line.length() > 0:
            predicate(line, {}, i)

    # ------------------------------------------------------------------
    # filter / map / forEach / reduce / partition
    # ------------------------------------------------------------------

    def filter(self, predicate) -> list:
        return [op for op in self.ops if predicate(op)]

    def map(self, fn) -> list:
        return [fn(op) for op in self.ops]

    def forEach(self, fn):
        for op in self.ops:
            fn(op)

    def reduce(self, fn, initial=None):
        acc = initial
        for op in self.ops:
            acc = fn(acc, op)
        return acc

    def partition(self, predicate):
        passed, failed = [], []
        for op in self.ops:
            (passed if predicate(op) else failed).append(op)
        return passed, failed

    # ------------------------------------------------------------------
    # Misc
    # ------------------------------------------------------------------

    def slice(self, start: int = 0, end: float = INFINITY) -> "Delta":
        ops = []
        iter_ = OpIter(self.ops)
        index = 0
        while index < end and iter_.hasNext():
            if index < start:
                op = iter_.next(start - index)
            else:
                op = iter_.next(end - index)
                ops.append(op)
            index += op.length()
        return Delta(ops)

    def __eq__(self, other):
        if not isinstance(other, Delta):
            return False
        if len(self.ops) != len(other.ops):
            return False
        return all(
            a.type == b.type and a.value == b.value and a.attributes == b.attributes
            for a, b in zip(self.ops, other.ops)
        )

    def __repr__(self):
        return f"Delta({self.ops!r})"
    
    def __str__(self):
        res = ""
        for op in self.ops:
            res += str(op) + ", "
        return f"[{res[:-2]}]"
    
    # def to_list(self):
    #     ret = []
    #     for op in self.ops:
    #         if op.
    

# Convert from python dict to Delta object
def delta_from_list(input_list):
    res = Delta()
    for op_dict in input_list:
        newop = Op()
        if ATTRIBUTES in op_dict:
            newop.attributes = op_dict[ATTRIBUTES]
        if INSERT in op_dict:
            newop.type = INSERT
            newop.value = op_dict[INSERT]
            res.push(newop)
        elif RETAIN in op_dict:
            newop.type = RETAIN
            newop.value = op_dict[RETAIN]
            res.push(newop)
        elif DELETE in op_dict:
            newop.type = DELETE
            newop.value = op_dict[DELETE]
            res.push(newop)
            
    return res
