
# delta is just list of ops
INSERT = 'insert'
RETAIN = 'retain'
DELETE = 'delete'
ATTRIBUTES = 'attributes'

def is_valid_op(op):
    if RETAIN in op:
        return isinstance(op[RETAIN], (float, int)) or isinstance(op[RETAIN], dict)
    if INSERT in op:
        return isinstance(op[INSERT], str) or len(op[INSERT]) == 1
    if DELETE in op:
        return isinstance(op[DELETE], (float, int))
    return False

def is_valid_delta(delta):
    ret = True
    for op in delta:
        ret = ret and is_valid_op(op)
    return ret

class OpIter:
    def __init__(self, delta):
        self.ops = delta
        self.index = 0
        self.offset = 0
        
    def peek(self):
        if self.index < len(self.ops):
            return self.ops[self.index]
        return None
    
    def peekLength(self) -> float:
        if self.index >= len(self.ops):
            return float('inf')
        cur_op = self.ops[self.index]
        return op_length(cur_op) - self.offset
    
    def peekType(self) -> str:
        if self.index >= len(self.ops):
            return ''
        cur_op = self.ops[self.index]
        if DELETE in cur_op:
            return DELETE
        elif RETAIN in cur_op:
            return RETAIN
        elif INSERT in cur_op:
            return INSERT
        return RETAIN
    
    def hasNext(self):
        return self.peekLength() < float('inf')
    
    def next(self, length=-1):
        if length <= 0: length = float('inf')
        if self.index >= len(self.ops):
            return {RETAIN: float('inf')}
        nextOp = self.ops[self.index]
        offset = self.offset
        opLength = op_length(nextOp)
        if length >= opLength - offset:
            length = opLength - offset
            self.index += 1
            self.offset = 0
        else:
            self.offset += length
            
        if DELETE in nextOp: # need to check if delete is 'int'
            return {DELETE: length}
        retOp = {}
        if ATTRIBUTES in nextOp:
            retOp[ATTRIBUTES] = nextOp[ATTRIBUTES]
        if RETAIN in nextOp:
            retOp[RETAIN] = length
        elif INSERT in nextOp:
            if isinstance(nextOp[INSERT], str):
                retOp[INSERT] = nextOp[INSERT][offset:offset + length]
            else:
                retOp[INSERT] = nextOp[INSERT]
        return retOp
                    
    def rest(self):
        if not self.hasNext():
            return []
        if self.offset == 0:
            return self.ops[self.index:]
        offset = self.offset
        index = self.index
        next = self.next()
        rest = []
        if self.index < len(self.ops):
            rest = self.ops[self.index:]
        self.offset = offset
        self.index = index
        return [next] + rest
        

def compose(A, B):
    # # print('compose called with', A, '|||', B)
    a_opiter = OpIter(A)
    b_opiter = OpIter(B)
    ret_delta = []
    firstOther = b_opiter.peek()
    if firstOther and RETAIN in firstOther:
        if isinstance(firstOther[RETAIN], (float, int)) and ATTRIBUTES not in firstOther:
            firstLeft = firstOther[RETAIN]
            while a_opiter.peekType() == INSERT and a_opiter.peekLength() <= firstLeft:
                firstLeft -= a_opiter.peekLength()
                ret_delta.append(a_opiter.next())
            if firstOther[RETAIN] - firstLeft > 0:
                b_opiter.next(firstOther[RETAIN] - firstLeft)
                
    while a_opiter.hasNext() or b_opiter.hasNext():
        if b_opiter.peekType() == INSERT:
            # # print('pushing other insert')
            ret_delta = push(ret_delta, b_opiter.next())
        elif a_opiter.peekType() == DELETE:
            # # print('pushing self delete')
            ret_delta = push(ret_delta, a_opiter.next())
        else:
            length = min(a_opiter.peekLength(), b_opiter.peekLength())
            # # print('before pop self', a_opiter.peek(), a_opiter.peekLength())
            a_op = a_opiter.next(length)
            # # print('popped', a_op)
            # # print('after pop self', a_opiter.peek(), a_opiter.peekLength())
            b_op = b_opiter.next(length)
            if RETAIN in b_op:
                newOp = {}
                if RETAIN in a_op and isinstance(a_op[RETAIN], (float, int)):
                    newOp[RETAIN] = length if isinstance(b_op[RETAIN], (float, int)) else b_op[RETAIN]
                else:
                    if isinstance(b_op[RETAIN], (float, int)):
                        if RETAIN in a_op:
                            newOp[RETAIN] = a_op[RETAIN]
                        else:
                            newOp[INSERT] = a_op[INSERT]
                    else:
                        action = RETAIN if (RETAIN in a_op) else INSERT
                        # print(a_op, b_op)
                        ## embedtypeanddata compose
                        newOp[action] = a_op[RETAIN] if (action == RETAIN) else b_op[RETAIN]
                        
                # compose attributes
                a_attrs = None
                b_attrs = None
                if ATTRIBUTES in a_op: a_attrs = a_op[ATTRIBUTES]
                if ATTRIBUTES in b_op: b_attrs = b_op[ATTRIBUTES]
                new_attrs = compose_attrs(a_attrs, b_attrs)
                if new_attrs: newOp[ATTRIBUTES] = new_attrs
                # print('pushing other retain or self retain/insert')
                push(ret_delta, newOp)
                
                # optimization: if rest of 'b' is only retain
                if not b_opiter.hasNext() and ret_delta[-1] == newOp:
                    rest = a_opiter.rest()
                    # print('adding rest of other', rest)
                    ret_delta = chop(concat(ret_delta, rest))
                    # print('after adding', ret_delta)
                    # print('compose return ', chop(ret_delta))
                    return (ret_delta)
                    
            # b_op should be delete
            elif DELETE in b_op and isinstance(b_op[DELETE], (float, int)):
                if RETAIN in a_op:
                    # print('pushing other delete')
                    push(ret_delta, b_op)
    
    # print('compose return ', chop(ret_delta))
    return chop(ret_delta)

def compose_attrs(a_attrs: dict, b_attrs: dict, keep_null: bool = False):
    if a_attrs is None:
        a_attrs = {}
    if b_attrs is None:
        b_attrs = {}
        
    ret_attrs = {k:v for k,v in b_attrs.items()}
    if not keep_null:
        ret_attrs = {k: v for k,v in ret_attrs.items() if v is not None}
        
    for ky in a_attrs:
        if ky not in b_attrs:
            ret_attrs[ky] = a_attrs[ky]
            
    return ret_attrs
        

def getEmbedTypeAndData(a_op: dict, b_op: dict):
    if a_op is None or b_op is None:
        return
    
    embedType = a_op.keys()[0]
    if embedType not in b_op:
        return
    
    return embedType, a_op[embedType], b_op[embedType]

def transform(A, B):
    priority = True if priority else False
    if isinstance(B, (float, int)):
        return transformPosition(A, B, priority)
    
    thisIter = OpIter(A)
    otherIter = OpIter(B)
    ret_delta = []
    while thisIter.hasNext() or otherIter.hasNext():
        if thisIter.peekType() == INSERT and (priority or (otherIter.peekType() != INSERT)):
            push(ret_delta, {RETAIN: op_length(thisIter.next())})
        elif otherIter.peekType() == INSERT:
            push(ret_delta, otherIter.next())
        else:
            length = min(thisIter.peekLength(), otherIter.peekLength())
            thisOp = thisIter.next(length)
            otherOp = otherIter.next(length)
            if DELETE in thisOp: continue
            elif DELETE in otherOp: push(ret_delta, otherOp)
            else:
                thisData = thisOp[RETAIN]
                otherData = otherOp[RETAIN]
                transformedData = length if isinstance(otherData, (float, int)) else otherData
                # if not isinstance(thisData, (float, int)) and not isinstance(otherData, (float, int)):
                #     # compose embed data, skipping for now
                a_attrs = thisOp[ATTRIBUTES] if ATTRIBUTES in thisOp else {}
                b_attrs = otherOp[ATTRIBUTES] if ATTRIBUTES in otherOp else {}
                push(ret_delta, {RETAIN: transformedData, ATTRIBUTES: compose_attrs(a_attrs, b_attrs, priority)})
                
    return chop(ret_delta)
    


def transformPosition(A: list, index: int, priority=False)->int:
    priority = True if priority else False
    thisIter = OpIter(A)
    offset = 0
    while thisIter.hasNext() and offset <= index:
        length = thisIter.peekLength()
        nextType = thisIter.peekType()
        thisIter.next()
        if nextType == DELETE:
            index -= min(length, index-offset)
            continue
        elif nextType == INSERT and ((offset < index) or (not priority)):
            index += length
        offset += length
    return index

def concat(A, B):
    ret_delta = [i for i in A]
    if len(B):
        push(ret_delta, B[0])
        ret_delta += B[1:]
    return ret_delta

def chop(delta: list):
    if not len(delta): return delta
    lastOp = delta[-1]
    if RETAIN in lastOp and ATTRIBUTES not in lastOp:
        delta.pop()
    return delta

def push(delta: list, new_op):
    # print('push called with ', delta, "|||", new_op)
    if not len(delta):
        delta.append(new_op)
        # print('push return', delta)
        return delta
    
    index = len(delta)
    last_op = delta[index-1]
    
    # need to make copy of op?
    if not is_valid_op(new_op) or not is_valid_delta(delta):
        # print('push return', delta)
        return delta
    
    if DELETE in new_op and DELETE in last_op:
        last_op[DELETE] += new_op[DELETE]
        # print('push return', delta)
        return delta
    if INSERT in new_op and DELETE in last_op:
        index -= 1
        last_op = delta[index-1]
        if index < 0:
            delta.insert(0, new_op)
            # print('push return', delta)
            return delta
    
    same_attrs = False
    if ATTRIBUTES not in last_op and ATTRIBUTES not in new_op:
        same_attrs = True
    elif ATTRIBUTES in last_op and ATTRIBUTES in new_op:
        if last_op[ATTRIBUTES] == new_op[ATTRIBUTES]:
            same_attrs = True
            
    if same_attrs:
        if INSERT in last_op and INSERT in new_op:
            if isinstance(last_op[INSERT], str) and isinstance(new_op[INSERT], str):
                last_op[INSERT] += new_op[INSERT]
                if ATTRIBUTES in new_op:
                    last_op[ATTRIBUTES] = new_op[ATTRIBUTES]
                # print('push return', delta)
                return delta
        elif RETAIN in last_op and RETAIN in new_op:
            if isinstance(last_op[RETAIN], (float, int)) and isinstance(new_op[RETAIN], (float, int)):
                last_op[RETAIN] += new_op[RETAIN]
                if ATTRIBUTES in new_op:
                    last_op[ATTRIBUTES] = new_op[ATTRIBUTES]
                # print('push return', delta)
                return delta
    
    delta.insert(index, new_op)
    # print('push return', delta)
    
    return delta

def op_length(op):
    if DELETE in op:
        if isinstance(op[DELETE], (float, int)):
            return op[DELETE]
    elif RETAIN in op:
        if isinstance(op[RETAIN], (float, int)):
            return op[RETAIN]
        else:
            return 1
    elif INSERT in op:
        if isinstance(op[INSERT], str):
            return len(op[INSERT])
        else:
            return 1
    return 0

def length(delta):
    if not is_valid_delta(delta):
        return 0
    ret_len = 0
    for op in delta:
        ret_len += op_length(op)
                
    return ret_len


if __name__ == "__main__":
    a = [{'insert': '\nqwertyasdfhg'}]
    b = [{'retain': 1, 'attributes': {'align': 'center'}}]
    # print(compose(a, b))