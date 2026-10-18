package com.botclone.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.botclone.android.domain.model.BotStatus

/** Deterministic colored initial avatar for a bot. */
@Composable
fun BotAvatar(name: String, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    val palette = listOf(0xFF8AB4F8, 0xFF81C995, 0xFFFDD663, 0xFFF28B82, 0xFFC58AF9, 0xFF78D9EC)
    val color = Color(palette[(name.hashCode() and Int.MAX_VALUE) % palette.size])
    Box(
        modifier.size(size).clip(CircleShape).background(color.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().take(1).uppercase().ifEmpty { "?" },
            color = color,
            fontWeight = FontWeight.SemiBold,
            fontSize = (size.value * 0.42f).sp,
        )
    }
}

@Composable
fun StatusDot(status: BotStatus, modifier: Modifier = Modifier) {
    val color = when (status) {
        BotStatus.READY -> Color(0xFF81C995)
        BotStatus.PROVISIONING -> Color(0xFFFDD663)
        BotStatus.ERROR -> MaterialTheme.colorScheme.error
        BotStatus.STOPPED, BotStatus.UNKNOWN -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Box(modifier.size(8.dp).clip(CircleShape).background(color))
}

fun BotStatus.label(): String = when (this) {
    BotStatus.READY -> "Ready"
    BotStatus.PROVISIONING -> "Starting…"
    BotStatus.STOPPED -> "Sleeping"
    BotStatus.ERROR -> "Error"
    BotStatus.UNKNOWN -> "Unknown"
}

/** Human-readable message for repository failures. */
fun Throwable.userMessage(): String = when (this) {
    is retrofit2.HttpException -> when (code()) {
        401 -> "Wrong password or session expired"
        404 -> "Not found on server"
        501 -> "Not supported by this server (screen sharing needs Docker mode)"
        503 -> "Bot sandbox unavailable right now"
        else -> "Server error (${code()})"
    }
    is java.net.UnknownHostException, is java.net.ConnectException -> "Can't reach the server. Check the URL in Settings."
    is java.net.SocketTimeoutException -> "Server took too long to respond"
    else -> message ?: "Something went wrong"
}
