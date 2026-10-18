package com.botclone.android.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.botclone.android.feature.auth.LoginScreen
import com.botclone.android.feature.bots.BotListScreen
import com.botclone.android.feature.bots.CreateBotScreen
import com.botclone.android.feature.chat.ChatScreen
import com.botclone.android.feature.screen.ScreenShareScreen
import com.botclone.android.feature.settings.SettingsScreen
import kotlinx.serialization.Serializable

@Serializable data object LoginRoute
@Serializable data object BotListRoute
@Serializable data object CreateBotRoute
@Serializable data object SettingsRoute
@Serializable data class ChatRoute(val botId: String)
@Serializable data class ScreenRoute(val botId: String, val botName: String)

@Composable
fun AppNavHost(navController: NavHostController, startLoggedIn: Boolean) {
    NavHost(navController, startDestination = if (startLoggedIn) BotListRoute else LoginRoute) {
        composable<LoginRoute> {
            LoginScreen(
                onLoggedIn = {
                    navController.navigate(BotListRoute) { popUpTo(LoginRoute) { inclusive = true } }
                },
                onOpenSettings = { navController.navigate(SettingsRoute) },
            )
        }
        composable<BotListRoute> {
            BotListScreen(
                onOpenBot = { navController.navigate(ChatRoute(it)) },
                onCreateBot = { navController.navigate(CreateBotRoute) },
                onOpenSettings = { navController.navigate(SettingsRoute) },
            )
        }
        composable<CreateBotRoute> {
            CreateBotScreen(
                onBack = { navController.popBackStack() },
                onCreated = { botId ->
                    navController.navigate(ChatRoute(botId)) { popUpTo(BotListRoute) }
                },
            )
        }
        composable<ChatRoute> {
            ChatScreen(
                onBack = { navController.popBackStack() },
                onOpenScreen = { botId, name -> navController.navigate(ScreenRoute(botId, name)) },
                onDeleted = { navController.popBackStack(BotListRoute, inclusive = false) },
            )
        }
        composable<ScreenRoute> {
            ScreenShareScreen(onBack = { navController.popBackStack() })
        }
        composable<SettingsRoute> {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
    }
}
