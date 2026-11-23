import assert from 'node:assert/strict'
import test from 'node:test'
import { isRoleReserved, recentlyUsed, withRoleReservation } from '../apps/internal/game-state.js'

test('reserves a character across groups while allowing other characters to start', async () => {
    const role = 'reservation-test-role'
    const otherRole = 'reservation-test-other-role'
    recentlyUsed.delete(role)
    recentlyUsed.delete(otherRole)

    let releaseFirst
    let firstStarted
    const started = new Promise(resolve => { firstStarted = resolve })
    const gate = new Promise(resolve => { releaseFirst = resolve })
    let duplicateStarted = false

    const first = withRoleReservation(role, async commitRole => {
        firstStarted()
        await gate
        commitRole()
        return true
    })

    try {
        await started
        assert.equal(isRoleReserved(role), true)
        assert.equal(await withRoleReservation(role, async () => {
            duplicateStarted = true
        }), false)
        assert.equal(duplicateStarted, false)

        const other = await withRoleReservation(otherRole, async commitRole => {
            commitRole()
            return true
        })
        assert.equal(other, true)
        assert.equal(recentlyUsed.has(otherRole), true)
    } finally {
        releaseFirst()
        await first
        recentlyUsed.delete(role)
        recentlyUsed.delete(otherRole)
    }

    assert.equal(isRoleReserved(role), false)
})

test('failed character starts release reservations without setting cooldown', async () => {
    const role = 'reservation-test-failed-role'
    recentlyUsed.delete(role)

    const result = await withRoleReservation(role, async () => false)

    assert.equal(result, false)
    assert.equal(isRoleReserved(role), false)
    assert.equal(recentlyUsed.has(role), false)
})

test('thrown character starts also release reservations without setting cooldown', async () => {
    const role = 'reservation-test-thrown-role'
    recentlyUsed.delete(role)

    await assert.rejects(
        withRoleReservation(role, async () => { throw new Error('start failed') }),
        /start failed/
    )

    assert.equal(isRoleReserved(role), false)
    assert.equal(recentlyUsed.has(role), false)
})
