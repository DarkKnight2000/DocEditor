"""Tokens the frontend signs with SHARED_JWT_SECRET: API tokens and edit-socket tokens."""
import os
import time

import pytest
from fastapi import HTTPException
from jose import jwt

from app.main import get_internal_user, get_socket_user

SECRET = os.environ['SHARED_JWT_SECRET']
DOC = '6f1c6d1e-0000-4000-8000-000000000001'


def token(claims, secret=SECRET, expires_in=60):
    return jwt.encode({**claims, 'exp': int(time.time()) + expires_in}, secret, algorithm='HS256')


def socket_token(**overrides):
    return token({'sub': 'user1', 'aud': 'edit-socket', 'doc_id': DOC, **overrides})


# --- edit-socket tokens -----------------------------------------------------

def test_socket_token_for_this_doc_is_accepted():
    assert get_socket_user(socket_token(), DOC) == 'user1'


@pytest.mark.parametrize('bad_token', [
    pytest.param(socket_token(doc_id='6f1c6d1e-0000-4000-8000-000000000002'), id='other-doc'),
    pytest.param(socket_token(aud='something-else'), id='wrong-audience'),
    pytest.param(token({'sub': 'user1', 'doc_id': DOC}), id='api-token-without-audience'),
    pytest.param(token({'sub': 'user1', 'aud': 'edit-socket', 'doc_id': DOC}, secret='attacker'), id='wrong-signature'),
    pytest.param(token({'sub': 'user1', 'aud': 'edit-socket', 'doc_id': DOC}, expires_in=-10), id='expired'),
    pytest.param('not-a-jwt', id='garbage'),
    pytest.param(None, id='missing'),
    pytest.param(12345, id='not-a-string'),
])
def test_invalid_socket_tokens_are_rejected(bad_token):
    assert get_socket_user(bad_token, DOC) is None


# --- API tokens ---------------------------------------------------------------

def test_api_token_is_accepted():
    assert get_internal_user(f"Bearer {token({'sub': 'user1'})}") == 'user1'


@pytest.mark.parametrize('bad_header', [
    pytest.param(f"Bearer {socket_token()}", id='socket-token-used-as-api-token'),
    pytest.param(f"Bearer {token({'sub': 'user1'}, secret='attacker')}", id='wrong-signature'),
    pytest.param(f"Bearer {token({'sub': 'user1'}, expires_in=-10)}", id='expired'),
    pytest.param('Bearer nonsense', id='garbage'),
])
def test_invalid_api_tokens_get_401(bad_header):
    with pytest.raises(HTTPException) as err:
        get_internal_user(bad_header)
    assert err.value.status_code == 401
